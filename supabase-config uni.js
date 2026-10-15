// Same Supabase project as your old event app (the tables are separate —
// everything here uses the "uni_" prefix). The anon public key is safe to
// ship in client code; it's what Supabase web apps are designed to expose.

window.SUPABASE_URL = "https://ksclkuaaaiktouoiryzg.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzY2xrdWFhYWlrdG91b2lyeXpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTk1NjcsImV4cCI6MjEwNDg5NTU2N30.YSErEzQs8TduvLjnHpjvB0qUL7BLQPeH8TTADqoCekE";

// Table name prefix. Must match supabase-schema.sql.
window.TABLE_PREFIX = "uni_";

// CUSTOMIZE: shown at the top of the guest page and in the browser tab.
window.EVENT_NAME = "3arrefni";

// CUSTOMIZE: change this before the party! It only keeps random guests from
// clicking "Run matching" — it is NOT real security, and anyone who views the
// page source can read it, so don't reuse a password you care about.
window.ADMIN_PASSCODE = "CHANGE_ME";
