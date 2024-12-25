import { RequestHandler } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';

export default class AnimeController {
    // @ts-ignore why even use ts
    public static handle: RequestHandler = async (request, response) => {
        const path = request.path.replace(/^\//, '');
        const episode = parseInt((request.query.episode as string) || '1');
        if (!episode) {
            return response.sendStatus(400);
        }

        const json = await getDataJson(`https://www3.animeflv.net/ver/${path}-${episode}`);
        const entry: {
            server: string;
            title: string;
            ads: number;
            url?: string;
            allow_mobile: Boolean;
            code: string;
        } = json.SUB.find((e: Record<string, string>) => e.server == 'sw');

        if (!entry) { // only handle sw entries for now, too lazy to research the other ones
            return response.sendStatus(404);
        }

        const targetUrl = entry.url || entry.code;
        const swData = await scrapeSW(targetUrl);
        if (!swData) {
            return response.sendStatus(404);
        }

        const streamlink = spawn('streamlink', [swData.url, 'best', '--stdout',
            "-decryption_key", swData.key, "-decryption_key_2", swData.key,
        ]);

        streamlink.on('error', (error) => {
            console.log(error);
            response.status(500).send('Error processing stream');
            response.end();
        });

        streamlink.stdout.pipe(response);
        const finishResponse = () => {
            console.log('finishing stream for ' + request.path);
            streamlink.kill('SIGINT');
            response.status(200);
        }

        response.on('finish', finishResponse);
        response.on('close', finishResponse);
    };
}

async function getDataJson(url: string) {
    let html = '';
    try {
        html = (await axios.get(url)).data as string;
    } catch {
        return null;
    }
    const $ = cheerio.load(html);
    const regex = /var\s+videos\s+=\s+({.*})/;
    const script = $('script[type="text/javascript"]')
        .not('src')
        .filter(function () {
            return regex.test($(this).text());
        })
        .text();

    if (!script) {
        return null;
    }

    try {
        return JSON.parse(script.match(regex)?.[1]!); // should exist cuz script isn't null :clueless:
    } catch {
        console.error('Failed to parse json');
        return null;
    }
}

async function scrapeSW(url: string): Promise<{ url: string, key: string } | null> {
    console.info('fetching entry ' + url);
    try {
        const { data }: { data: string } = await axios.get(url);
        const $ = cheerio.load(data);
        const regex =
            /eval\(function\(p,a,c,k,e,d\){while\(c--\)if\(k\[c\]\)p=p\.replace\(new\s*RegExp\('\\\\b'\+c\.toString\(a\)\+'\\\\b','g'\),k\[c\]\);return p}\('(.*)',(\d+),(\d+),(.*)\.split\('\|'\)\)\)/;
        const script = $('script[type="text/javascript"]')
            .not('src')
            .filter(function () {
                return regex.test($(this).text());
            })
            .text();

        const keyMatches = data.match(/jwplayer\.key\s*=\s*"(.*)"/);

        const match = script.match(regex)!;
        if (!match || match.length < 5) {
            console.info(match);
            return null;
        }

        const pp = match[1].replace(/\\'/g, '\'');
        const aa = parseInt(match[2]);
        const cc = parseInt(match[3]);
        const kk = match[4].split('|');

        // @ts-ignore
        const deobfuscated = (function (p, a, c, k, e, d) {
            while (c--)
                if (k[c])
                    p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
            return p
        })
            (pp, aa, cc, kk)

        const match2 = deobfuscated.match(/sources:\[\{file:"(.*)"\}\],ima/);

        if (match2) {
            // totally robust code here
            // replace shenanigans cuz i'm too lazy
            return { url: match2[1].replace(/'/g, '0'), key: keyMatches ? keyMatches[1] : '' };
        }
    } catch (e: any) {
        console.error('failed to scrape sw: ' + e.message);
    }

    return null;
}
