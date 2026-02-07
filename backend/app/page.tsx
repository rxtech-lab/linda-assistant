import Link from 'next/link';

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: '600px',
      }}>
        <div style={{
          fontSize: '72px',
          fontWeight: 'bold',
          marginBottom: '16px',
          letterSpacing: '-0.02em',
        }}>
          Linda Assistant
        </div>
        
        <p style={{
          fontSize: '24px',
          opacity: 0.95,
          margin: '0 0 48px 0',
          fontWeight: '300',
        }}>
          Personal assistant backend API
        </p>
        
        <a 
          href="/openapi.json"
          style={{
            padding: '16px 32px',
            background: 'white',
            color: '#764ba2',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: '600',
            fontSize: '16px',
            display: 'inline-block',
          }}
        >
          View API Documentation
        </a>
      </div>
    </div>
  );
}
