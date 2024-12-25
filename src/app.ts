import express from 'express';
const app = express();
import AnimeRouter from './anime-router';

app.use('/', AnimeRouter);

app.listen(3000, () => {
  console.log('lets gooo');
});
