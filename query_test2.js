const url = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?limit=1';
const headers = {
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvend5c2d1YnZxeGN6eWpybXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTY0NzcsImV4cCI6MjA5NjA3MjQ3N30.JjcYLaCBhtoVpbjmRs6vQN4V8lUZ00hgU92f0o0T-IM',
  'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvend5c2d1YnZxeGN6eWpybXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTY0NzcsImV4cCI6MjA5NjA3MjQ3N30.JjcYLaCBhtoVpbjmRs6vQN4V8lUZ00hgU92f0o0T-IM'
};

fetch(url, { headers })
  .then(res => res.json())
  .then(data => {
    if (data.length > 0) {
      console.log('Columns:', Object.keys(data[0]));
    } else {
      console.log('Empty array.');
    }
  })
  .catch(console.error);
