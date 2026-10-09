const url1 = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=key_remote_jid&limit=1';
const url2 = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=chat_jid&limit=1';
const url3 = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=remote_jid&limit=1';
const url4 = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=sender_phone&limit=1';
const headers = {
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvend5c2d1YnZxeGN6eWpybXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTY0NzcsImV4cCI6MjA5NjA3MjQ3N30.JjcYLaCBhtoVpbjmRs6vQN4V8lUZ00hgU92f0o0T-IM'
};
Promise.all([
  fetch(url1, { headers }).then(r=>r.json()),
  fetch(url2, { headers }).then(r=>r.json()),
  fetch(url3, { headers }).then(r=>r.json()),
  fetch(url4, { headers }).then(r=>r.json())
]).then(results => {
  console.log("key_remote_jid:", results[0].code || "Exists");
  console.log("chat_jid:", results[1].code || "Exists");
  console.log("remote_jid:", results[2].code || "Exists");
  console.log("sender_phone:", results[3].code || "Exists");
});
