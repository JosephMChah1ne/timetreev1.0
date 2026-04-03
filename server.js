const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Server is alive');
});

app.get('/status.json', (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    time: new Date().toISOString()
  });
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
