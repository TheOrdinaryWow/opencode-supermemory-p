export function createSuccessPage(): string {
  return `
            <!DOCTYPE html>
            <html>
            <head><title>Success</title></head>
            <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa;">
              <div style="text-align: center;">
                <h1 style="color: #22c55e;">✓ Connected!</h1>
                <p>You can close this window and return to your terminal.</p>
              </div>
            </body>
            </html>
          `;
}

export function createFailurePage(): string {
  return `
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa;">
              <div style="text-align: center;">
                <h1 style="color: #ef4444;">✗ Connection Failed</h1>
                <p>No API key received. Please try again.</p>
              </div>
            </body>
            </html>
          `;
}
