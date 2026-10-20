// ---------------------------------------------------------------------------
// Baked-in Supabase connection for the Midweek Meeting Scheduler.
// Same dedicated Sta. Fe project as the Field Service app, but this app only
// ever touches the isolated `midweek` schema (set below). The key is the
// Supabase *anon public* key — it is meant to live in browser code and is
// protected by Row Level Security.
//
// Leave `key` empty ('') to fall back to the one-time manual setup screen.
// ---------------------------------------------------------------------------
window.MW_CONFIG = {
  url: 'https://jxjkphmxykeucpxmncla.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4amtwaG14eWtldWNweG1uY2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMDEzNjYsImV4cCI6MjA5OTc3NzM2Nn0.yiUXfv5qwBFd-DzvYlZYsrARNCuXpjLI2XTCyzUktGY',
  schema: 'midweek'
};
