const url1 = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=receiver_phone&limit=1';
const url2 = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=contact_phone&limit=1';
const url3 = 'https://wozwysgubvqxczyjrmtn.supabase.co/rest/v1/messages?select=receiver_jid&limit=1';
const headers = {
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indvend5c2d1YnZxeGN6eWpybXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0OTY0NzcsImV4cCI6MjA5NjA3MjQ3N30.JjcYLaCBhtoVpbjmRs6vQN4V8lUZ00hgU92f0o0T-IM'
};
Promise.all([
  fetch(url1, { headers }).then(r=>r.json()),
  fetch(url2, { headers }).then(r=>r.json()),
  fetch(url3, { headers }).then(r=>r.json())
]).then(results => {
  console.log("receiver_phone:", results[0].code || "Exists");
  console.log("contact_phone:", results[1].code || "Exists");
  console.log("receiver_jid:", results[2].code || "Exists");
});
