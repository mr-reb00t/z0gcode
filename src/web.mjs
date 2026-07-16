// Web tools: fetch a URL as readable text, and search the web (DuckDuckGo HTML,
// no API key). Dependency-free (global fetch, Node 18+). Used by the agent's
// web_fetch / web_search tools so it can read docs and look things up.
const MAX = 20000;
const UA = "Mozilla/5.0 (compatible; z0gcode/0.3; +https://github.com/mr-reb00t/z0gcode)";

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,;:!?)\]])/g, "$1")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Parse DuckDuckGo HTML results into [{ title, url, snippet }].
export function parseDdgResults(html) {
  const out = [];
  const snips = [];
  const snipRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = snipRe.exec(html))) snips.push(htmlToText(m[1]));
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let i = 0;
  while ((m = linkRe.exec(html))) {
    let url = m[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    else if (url.startsWith("//")) url = "https:" + url;
    out.push({ url, title: htmlToText(m[2]), snippet: snips[i] || "" });
    i++;
  }
  return out;
}

export async function webFetch(url) {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const ct = res.headers.get("content-type") || "";
    let text = await res.text();
    if (/html|xml/i.test(ct)) text = htmlToText(text);
    else text = String(text).trim();
    if (text.length > MAX) text = text.slice(0, MAX) + "\n… [truncated]";
    return { ok: res.ok, summary: `fetched ${url} (${res.status})`, content: text || "(empty page)" };
  } catch (e) {
    return { ok: false, summary: "web_fetch failed", content: `ERROR: ${e.message}` };
  }
}

export async function webSearch(query) {
  try {
    const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const results = parseDdgResults(await res.text()).slice(0, 6);
    if (!results.length) {
      return { ok: false, summary: `search "${query}" (0)`, content: "No results parsed. The search page may have changed; try web_fetch on a specific URL instead." };
    }
    const content = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
    return { ok: true, summary: `search "${query}" (${results.length})`, content };
  } catch (e) {
    return { ok: false, summary: "web_search failed", content: `ERROR: ${e.message}` };
  }
}
