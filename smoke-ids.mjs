import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const key = process.env.GEMINI_API_KEY;

const tools = [
  {
    functionDeclarations: [
      {
        name: 'google_search',
        description: 'Searches the web.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    ],
  },
];

function contents(withId) {
  const id = 'abc123XYZ';
  return [
    { role: 'user', parts: [{ text: 'Search for TSLA revenue, then answer in one sentence.' }] },
    {
      role: 'model',
      parts: [
        {
          functionCall: {
            ...(withId ? { id } : {}),
            name: 'google_search',
            args: { query: 'TSLA revenue' },
          },
        },
      ],
    },
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            ...(withId ? { id } : {}),
            name: 'google_search',
            response: { name: 'google_search', content: '{"answer":"Revenue was 25.2B."}' },
          },
        },
      ],
    },
  ];
}

for (const model of ['gemini-2.5-flash', 'gemini-3.6-flash']) {
  for (const withId of [true, false]) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: contents(withId), tools }),
      },
    );
    const body = await res.text();
    console.log(
      `${model} withId=${withId}: ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 120)}`,
    );
  }
}
