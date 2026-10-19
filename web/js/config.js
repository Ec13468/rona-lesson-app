// 公開設定：這兩個值本來就是給網頁用的，可以公開
export const SUPABASE_URL = "https://jjwviguwkacgcxgljeak.supabase.co";
export const SUPABASE_PUBLIC_KEY = "sb_publishable_NUN1iOVnv0WbpvnR-82fbQ_O-h52sae";

// 展示模式：只在自己電腦上（localhost）加上 ?demo 才會開啟，資料只存在這台電腦的瀏覽器
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
export const DEMO = local && new URLSearchParams(location.search).has("demo");

// 推播用的公開金鑰（可以公開；對應的私密金鑰只存在雲端）
export const VAPID_PUBLIC_KEY = "BOfgWDSqW6lYy4m4dCdEwrjuQAhfNvt-M3V4jhvjkq4qTlCe84lm9573artXKkiBhKKfdzOnYSynEqsm6pXM_3M";
