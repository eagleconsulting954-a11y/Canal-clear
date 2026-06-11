const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateArticle(keyword, options = {}) {
  const { tone = 'professional', wordCount = 1500 } = options;
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Write an SEO-optimized article for the keyword: "${keyword}".

Requirements:
- Target word count: ${wordCount} words
- Tone: ${tone}
- Include a compelling H1 title
- Use H2/H3 subheadings naturally
- Write a 150-character meta description
- Create a URL-friendly slug
- Naturally include the keyword and semantic variants

Respond ONLY with valid JSON in this exact shape:
{
  "title": "Article title here",
  "meta": "150-char meta description",
  "slug": "url-friendly-slug",
  "content": "Full HTML article content with proper heading tags",
  "word_count": 1500
}`
    }]
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI returned invalid JSON');
  return JSON.parse(jsonMatch[0]);
}

async function generateKeywordCluster(seedKeyword) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Generate a keyword cluster for: "${seedKeyword}"

Return ONLY valid JSON:
{
  "primary": "${seedKeyword}",
  "cluster": [
    {"keyword": "long-tail variant", "intent": "informational|commercial|transactional", "difficulty": 1-100, "volume": "estimated monthly searches"}
  ]
}
Include 8-12 keywords covering different intents.`
    }]
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI returned invalid JSON');
  return JSON.parse(jsonMatch[0]);
}

async function analyzeVisibility(brand, keyword) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are an AI visibility analyst. Evaluate how well the brand "${brand}" appears in AI-generated responses when users search for "${keyword}".

Based on your training knowledge, estimate:
- A visibility score 0-100 (how often this brand would appear in AI answers)
- Number of estimated AI mention contexts
- Brief analysis of brand presence

Return ONLY valid JSON:
{
  "score": 42,
  "mentions": 3,
  "analysis": "Two-sentence analysis of the brand's AI visibility for this keyword."
}`
    }]
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI returned invalid JSON');
  return JSON.parse(jsonMatch[0]);
}

module.exports = { generateArticle, generateKeywordCluster, analyzeVisibility };
