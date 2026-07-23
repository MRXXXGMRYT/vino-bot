export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { url } = await req.json();

    const videoIdMatch = url.match(/(?:v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
      return new Response(JSON.stringify({ error: 'Invalid YouTube URL' }), { status: 400 });
    }
    const videoId = videoIdMatch[1];

    let transcript = '';
    let title = '';
    let language = 'en';

    try {
      const transcriptResponse = await fetch(
        `https://youtube-transcript.ai/transcript/${videoId}.txt?lang=en`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/plain, text/markdown, */*',
          }
        }
      );

      if (transcriptResponse.ok) {
        const text = await transcriptResponse.text();
        
        const titleMatch = text.match(/^# Transcript:\s*(.+)$/m);
        if (titleMatch) title = titleMatch[1].trim();

        const langMatch = text.match(/^Language:\s*(\S+)/m);
        if (langMatch) language = langMatch[1];

        const lines = text.split('\n');
        const transcriptLines = [];
        let inTranscript = false;
        
        for (const line of lines) {
          if (line.match(/^\[\d+:\d+\]/)) {
            inTranscript = true;
          }
          if (inTranscript && line.trim()) {
            const cleaned = line.replace(/^\[\d+:\d+\]\s*/, '').trim();
            if (cleaned) transcriptLines.push(cleaned);
          }
        }
        
        transcript = transcriptLines.join(' ');
      }
    } catch (e) {
      console.error('youtube-transcript.ai failed:', e.message);
    }

    if (!transcript) {
      try {
        const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html',
          }
        });
        const pageHtml = await pageResponse.text();

        if (!title) {
          const titleMatch = pageHtml.match(/<title[^>]*>(.*?)<\/title>/);
          if (titleMatch) title = titleMatch[1].replace(' - YouTube', '').trim();
        }

        let description = '';
        const descMatch = pageHtml.match(/"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (descMatch) description = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\u0026/g, '&');

        const playerResponseMatch = pageHtml.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:var\s|<)/);
        
        if (playerResponseMatch) {
          let playerResponse;
          try {
            playerResponse = JSON.parse(playerResponseMatch[1]);
          } catch (e) {
            playerResponse = null;
          }

          if (playerResponse) {
            const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            
            if (captions && captions.length > 0) {
              let captionTrack = captions.find(c => c.languageCode.startsWith('en')) || captions[0];
              language = captionTrack.languageCode;

              try {
                const captionResponse = await fetch(captionTrack.baseUrl + '&fmt=json3', {
                  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                const captionData = await captionResponse.json();

                if (captionData && captionData.events) {
                  const segments = captionData.events
                    .filter(e => e.segs)
                    .map(e => e.segs.map(s => s.utf8).join('').trim())
                    .filter(t => t && t !== '\n');
                  transcript = segments.join(' ');
                }
              } catch (e) {
                console.error('Caption fetch failed:', e.message);
              }

              if (!transcript) {
                try {
                  const captionXml = await (await fetch(captionTrack.baseUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                  })).text();

                  const textSegments = [];
                  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
                  let match;
                  while ((match = regex.exec(captionXml)) !== null) {
                    const decoded = match[1]
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&#39;/g, "'")
                      .replace(/&quot;/g, '"')
                      .replace(/\n/g, ' ')
                      .trim();
                    if (decoded) textSegments.push(decoded);
                  }
                  transcript = textSegments.join(' ');
                } catch (e) {
                  console.error('XML caption fetch failed:', e.message);
                }
              }
            }
          }
        }

        if (!transcript && description) {
          transcript = `[No captions available. Video description:]\n${description}`;
        }
      } catch (e) {
        console.error('YouTube fallback failed:', e.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      title,
      description: '',
      transcript,
      language
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}