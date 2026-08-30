#!/usr/bin/env python3
"""
Reapply the custom sidebar patch (solid blue color, thin auto-hide scrollbar,
contrast fix, minimize/maximize) onto whatever apps/web/dist files are
currently live. Safe to re-run after every "Update Aplikasi" upload, because
each Update Aplikasi zip ships fresh hashed asset filenames that don't carry
these customizations.

Usage: sudo python3 reapply_sidebar_patch.py [APP_ROOT]
Default APP_ROOT: /www/wwwroot/partitionb/siakad.sman3mjk.sch.id
"""
import os
import re
import sys

APP_ROOT = sys.argv[1] if len(sys.argv) > 1 else "/www/wwwroot/partitionb/siakad.sman3mjk.sch.id"
DIST = os.path.join(APP_ROOT, "apps/web/dist")
INDEX_HTML = os.path.join(DIST, "index.html")

CSS_MARKER = "sidebar-toggle-btn"
CSS_ADDITION = (
".app-sidebar{--sidebar:#0f91fc;--fg:#f0f9ff;--muted:rgba(255,255,255,.85);--divider:rgba(255,255,255,.18);"
"--card-border:rgba(255,255,255,.18);--hover:rgba(255,255,255,.12);--accent:#f0f9ff;"
"--accent-soft:rgba(255,255,255,.18);background:#0f91fc;color:#f0f9ff}"
".app-sidebar nav{scrollbar-width:thin;scrollbar-color:transparent transparent}"
".app-sidebar nav:hover{scrollbar-color:rgba(255,255,255,.35) transparent}"
".app-sidebar nav::-webkit-scrollbar{width:6px}"
".app-sidebar nav::-webkit-scrollbar-thumb{background:transparent;border-radius:9999px}"
".app-sidebar nav:hover::-webkit-scrollbar-thumb{background:rgba(255,255,255,.35)}"
".app-sidebar .text-slate-400{color:rgba(255,255,255,.55)}"
".app-sidebar .dark\\:text-slate-500{color:rgba(255,255,255,.55)}"
".app-sidebar.w-\\[260px\\]{transition:width .25s ease}"
".lg\\:pl-\\[260px\\]{transition:padding-left .25s ease}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\]{width:76px}"
"@media(min-width:1024px){html.sidebar-collapsed .lg\\:pl-\\[260px\\]{padding-left:76px}}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\] nav a{font-size:0;justify-content:center;gap:0;padding-left:0;padding-right:0}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\] nav a span{font-size:20px}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\] nav>div>div:has(.text-\\[10px\\]){display:none}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\]>div:first-child>div.min-w-0{display:none}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\]>div:first-child{justify-content:center;padding-left:0;padding-right:0}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\]>div:last-child>div:first-child{display:none}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\]>div:last-child>div:last-child button{font-size:0;padding-left:0;padding-right:0}"
"html.sidebar-collapsed .app-sidebar.w-\\[260px\\]>div:last-child>div:last-child button .material-symbols-outlined{font-size:20px}"
"#sidebar-toggle-btn{position:fixed;top:22px;left:244px;z-index:35;width:26px;height:26px;border-radius:9999px;background:#fff;color:#0f91fc;border:none;box-shadow:0 2px 8px rgba(0,0,0,.25);display:none;align-items:center;justify-content:center;cursor:pointer;font-size:13px;line-height:1;transition:left .25s ease,transform .25s ease;padding:0}"
"#sidebar-toggle-btn:hover{background:#f0f9ff}"
"@media(min-width:1024px){#sidebar-toggle-btn{display:flex}}"
"html.sidebar-collapsed #sidebar-toggle-btn{left:60px;transform:rotate(180deg)}"
)

HEAD_SCRIPT = '<script>(function(){try{if(localStorage.getItem("sbc")==="1")document.documentElement.classList.add("sidebar-collapsed")}catch(e){}})();</script>\n    '

BODY_SCRIPT = '''<script>
    (function(){
      function hasSidebar(){
        return !!document.querySelector(".app-sidebar.w-\\\\[260px\\\\]");
      }
      function sync(btn){
        btn.style.display = hasSidebar() ? "" : "none";
      }
      function init(){
        var btn=document.createElement("button");
        btn.id="sidebar-toggle-btn";
        btn.type="button";
        btn.setAttribute("aria-label","Perkecil/perbesar sidebar");
        btn.textContent="\\u2039";
        btn.style.display="none";
        btn.addEventListener("click",function(){
          var html=document.documentElement;
          var collapsed=html.classList.toggle("sidebar-collapsed");
          try{localStorage.setItem("sbc",collapsed?"1":"0")}catch(e){}
        });
        document.body.appendChild(btn);
        sync(btn);
        var mo=new MutationObserver(function(){sync(btn)});
        mo.observe(document.body,{childList:true,subtree:true});
      }
      if(document.readyState==="loading"){
        document.addEventListener("DOMContentLoaded",init);
      }else{
        init();
      }
    })();
    </script>
  '''


def main():
    if os.geteuid() != 0:
        print("Must run as root (use sudo).", file=sys.stderr)
        sys.exit(1)

    with open(INDEX_HTML, "r", encoding="utf-8") as f:
        html = f.read()

    js_match = re.search(r'<script[^>]+src="(/assets/index-[^"]+\.js)"', html)
    css_match = re.search(r'<link[^>]+href="(/assets/index-[^"]+\.css)"', html)
    if not js_match or not css_match:
        print("Could not locate current asset paths in index.html", file=sys.stderr)
        sys.exit(1)

    css_path = os.path.join(DIST, css_match.group(1).lstrip("/"))
    print(f"Detected live CSS: {css_path}")

    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    if CSS_MARKER in css:
        print("CSS already patched, skipping.")
    else:
        css += CSS_ADDITION
        with open(css_path, "w", encoding="utf-8") as f:
            f.write(css)
        print("CSS patched.")

    if CSS_MARKER in html:
        print("index.html already patched, skipping.")
        return

    head_marker = '  <head>\n    <meta charset="UTF-8" />'
    assert html.count(head_marker) == 1, "head marker not found or not unique"
    html = html.replace(head_marker, f'  <head>\n    {HEAD_SCRIPT}<meta charset="UTF-8" />')

    body_close = "  </body>"
    assert html.count(body_close) == 1, "body close tag not found or not unique"
    html = html.replace(body_close, f"    {BODY_SCRIPT}</body>")

    with open(INDEX_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print("index.html patched.")


if __name__ == "__main__":
    main()
