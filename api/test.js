export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_KEY;
  res.status(200).json({ 
    has_key: !!key,
    key_prefix: key ? key.substring(0, 20) + '...' : 'missing'
  });
}
