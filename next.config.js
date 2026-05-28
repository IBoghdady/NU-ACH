/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://fbrlvkjduscvzmjynxvg.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZicmx2a2pkdXNjdnptanlueHZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODY2MjAsImV4cCI6MjA5NTU2MjYyMH0.fIQI1U7CMvQeprJHd4zvMunrP6RTBvxUUlb0KR04PA0"
  }
}

module.exports = nextConfig
