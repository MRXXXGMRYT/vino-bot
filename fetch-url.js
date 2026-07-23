export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { url } = await req.json();

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400 });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return new Response(JSON.stringify({
        success: true,
        title: parsedUrl.hostname,
        description: `This is a ${contentType} resource. URL: ${url}`,
        content: `Non-HTML content type: ${contentType}. Cannot extract text content from this URL.`,
        url,
        statusCode: response.status,
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const html = await response.text();

    let title = '';
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = titleMatch[1].replace(/\s+/g, ' ').trim();

    let description = '';
    const descPatterns = [
      /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i,
      /<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i,
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i,
      /<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:description["']/i,
    ];
    for (const pattern of descPatterns) {
      const match = html.match(pattern);
      if (match) {
        description = match[1].trim();
        break;
      }
    }

    let bodyContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<svg[^>]*\/>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (bodyContent.length > 12000) {
      bodyContent = bodyContent.substring(0, 12000) + '\n\n[Content truncated...]';
    }

    return new Response(JSON.stringify({
      success: true,
      title,
      description,
      content: bodyContent,
      url,
      statusCode: response.status,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    let message = error.message;
    if (error.name === 'TimeoutError' || message.includes('timeout')) {
      message = 'Request timed out after 15 seconds. The website may be slow or unavailable.';
    }
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}