const url = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=id,conversation_id,sender_phone,sender_jid,content_text&sender_phone=like.*85225455484981*&limit=5';
const headers = {
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvend5c2d1YnZxeGN6eWpybXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTY0NzcsImV4cCI6MjA5NjA3MjQ3N30.JjcYLaCBhtoVpbjmRs6vQN4V8lUZ00hgU92f0o0T-IM',
  'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvend5c2d1YnZxeGN6eWpybXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTY0NzcsImV4cCI6MjA5NjA3MjQ3N30.JjcYLaCBhtoVpbjmRs6vQN4V8lUZ00hgU92f0o0T-IM'
};
fetch(url, { headers }).then(r=>r.json()).then(data => console.log(JSON.stringify(data, null, 2))).catch(console.error);
