/** Inline script for layout <head>: light dashboard theme before paint (no FOUC). */
export const THEME_INIT_SCRIPT = `(function(){
try{document.documentElement.setAttribute('data-theme','light');}catch(e){}
})();`;
