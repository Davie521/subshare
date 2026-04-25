import { THEME_COOKIE_NAME, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Inline blocking <script> that sets `.dark` on <html> before paint.
 *
 * Runs in the browser (not on the server). Reads localStorage first, then
 * cookie, then falls back to "auto" + matchMedia. Any failure falls back to
 * light without throwing — must never break SSR hydration.
 */
export function ThemeScript() {
  const code = `(function(){try{
var STORAGE_KEY=${JSON.stringify(THEME_STORAGE_KEY)};
var COOKIE_NAME=${JSON.stringify(THEME_COOKIE_NAME)};
function readMode(){
  try{var v=localStorage.getItem(STORAGE_KEY);if(v==='light'||v==='dark'||v==='auto')return v;}catch(e){}
  var m=document.cookie.match(new RegExp('(?:^|; )'+COOKIE_NAME+'=([^;]*)'));
  if(m){var c=decodeURIComponent(m[1]);if(c==='light'||c==='dark'||c==='auto')return c;}
  return 'auto';
}
var mode=readMode();
var dark=mode==='dark'||(mode==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var root=document.documentElement;
if(dark)root.classList.add('dark');else root.classList.remove('dark');
root.setAttribute('data-theme',dark?'dark':'light');
}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
