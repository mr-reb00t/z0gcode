import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, parseDdgResults } from "../src/web.mjs";

test("htmlToText strips tags and decodes entities", () => {
  const html = "<h1>Title</h1><p>Hello &amp; welcome to <b>z0g</b>.</p><script>evil()</script>";
  const t = htmlToText(html);
  assert.match(t, /Title/);
  assert.match(t, /Hello & welcome to z0g\./);
  assert.ok(!/evil/.test(t), "script contents removed");
  assert.ok(!/</.test(t), "no angle brackets left");
});

test("parseDdgResults extracts title, real url (uddg), and snippet", () => {
  const html = `
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc&rut=abc">Example <b>Title</b></a>
      <a class="result__snippet" href="x">A snippet about <b>example</b>.</a>
    </div>
    <div class="result">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffoo.dev%2Fapi">Foo API</a>
      <a class="result__snippet" href="x">Foo docs.</a>
    </div>`;
  const r = parseDdgResults(html);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { url: "https://example.com/doc", title: "Example Title", snippet: "A snippet about example." });
  assert.equal(r[1].url, "https://foo.dev/api");
  assert.equal(r[1].title, "Foo API");
});

test("parseDdgResults returns [] on unrelated html", () => {
  assert.deepEqual(parseDdgResults("<html><body>no results here</body></html>"), []);
});
