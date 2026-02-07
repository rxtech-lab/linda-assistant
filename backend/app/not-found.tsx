import Link from 'next/link';

export default function NotFound() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>404 - Page Not Found | Linda Assistant API</title>
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '20px',
        }}>
          <div style={{
            textAlign: 'center',
            maxWidth: '600px',
          }}>
            <div style={{
              fontSize: '120px',
              fontWeight: 'bold',
              lineHeight: 1,
              marginBottom: '20px',
              opacity: 0.9,
            }}>
              404
            </div>
            
            <h1 style={{
              fontSize: '32px',
              fontWeight: '600',
              margin: '0 0 16px 0',
            }}>
              Page Not Found
            </h1>
            
            <p style={{
              fontSize: '18px',
              opacity: 0.9,
              margin: '0 0 32px 0',
              lineHeight: 1.6,
            }}>
              The endpoint you're looking for doesn't exist. Check the API documentation for available routes.
            </p>
            
            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link 
                href="/"
                style={{
                  padding: '12px 24px',
                  background: 'white',
                  color: '#764ba2',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontWeight: '600',
                  fontSize: '16px',
                  transition: 'transform 0.2s',
                  display: 'inline-block',
                }}
              >
                Go Home
              </Link>
              
              <a 
                href="/openapi.json"
                style={{
                  padding: '12px 24px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  color: 'white',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontWeight: '600',
                  fontSize: '16px',
                  border: '2px solid rgba(255, 255, 255, 0.4)',
                  transition: 'transform 0.2s',
                  display: 'inline-block',
                }}
              >
                View API Docs
              </a>
            </div>
          </div>
          
          <footer style={{
            position: 'absolute',
            bottom: '20px',
            fontSize: '14px',
            opacity: 0.7,
          }}>
            Linda Assistant API
          </footer>
        </div>
      </body>
    </html>
  );
}
