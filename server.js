const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Railway server is alive');
});

app.get('/status.json', (req, res) => {
  res.json({ ok: true, message: 'basic server working' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
