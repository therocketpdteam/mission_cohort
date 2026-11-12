import test from "node:test";
import assert from "node:assert/strict";
import { resolveSendGridAttachments } from "../../src/services/emailService";

test("private invoice attachments use a fresh link instead of a stored expired URL on every attempt", async () => {
  const original=globalThis.fetch,urls:string[]=[],keys:string[]=[];
  globalThis.fetch=(async(url:any)=>{urls.push(String(url));return new Response("%PDF-1.4 synthetic invoice",{headers:{"content-type":"application/pdf"}});}) as typeof fetch;
  const sign=async(key:string)=>{keys.push(key);return `https://files.example.org/fresh-${keys.length}`;};
  try {
    const attachment={provider:"supabase",fileKey:"invoice/old-invoice.pdf",fileName:"Invoice.pdf",url:"https://files.example.org/expired",contentType:"application/pdf"};
    const first=await resolveSendGridAttachments([attachment],sign);
    await resolveSendGridAttachments([attachment],sign);
    assert.deepEqual(keys,[attachment.fileKey,attachment.fileKey]);
    assert.deepEqual(urls,["https://files.example.org/fresh-1","https://files.example.org/fresh-2"]);
    assert.equal(Buffer.from(first[0].content,"base64").toString(),"%PDF-1.4 synthetic invoice");
    assert.equal(first[0].filename,"Invoice.pdf");
    assert.equal(attachment.url,"https://files.example.org/expired");
  } finally {globalThis.fetch=original;}
});

test("invoice and external W-9 both attach, including a private invoice without a saved URL", async()=>{
  const original=globalThis.fetch,urls:string[]=[];
  globalThis.fetch=(async(url:any)=>{urls.push(String(url));return new Response("%PDF-1.4 synthetic document");}) as typeof fetch;
  try {
    const result=await resolveSendGridAttachments([{provider:"supabase",fileKey:"invoice/a.pdf",fileName:"Invoice.pdf",contentType:"application/pdf"},{provider:"external",fileKey:"registration/r/w9",fileName:"W-9.pdf",url:"https://example.org/w9.pdf",contentType:"application/pdf"}],async()=>"https://example.org/fresh-invoice.pdf");
    assert.deepEqual(result.map(item=>item.filename),["Invoice.pdf","W-9.pdf"]);
    assert.deepEqual(urls,["https://example.org/fresh-invoice.pdf","https://example.org/w9.pdf"]);
  }finally{globalThis.fetch=original;}
});

test("missing or invalid private documents stop delivery rather than omitting the invoice",async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=(async()=>new Response("missing",{status:404})) as typeof fetch;
    await assert.rejects(resolveSendGridAttachments([{provider:"supabase",fileKey:"invoice/a.pdf",fileName:"Invoice.pdf"}],async()=>"https://example.org/fresh"),/could not be downloaded/);
    globalThis.fetch=(async()=>new Response("<html>login</html>")) as typeof fetch;
    await assert.rejects(resolveSendGridAttachments([{provider:"supabase",fileKey:"invoice/a.pdf",fileName:"Invoice.pdf",contentType:"application/pdf"}],async()=>"https://example.org/fresh"),/direct PDF/);
    await assert.rejects(resolveSendGridAttachments([{provider:"supabase",fileKey:"invoice/a.pdf",fileName:"Invoice.pdf"}],async()=>{throw new Error("Storage unavailable");}),/Storage unavailable/);
  } finally {globalThis.fetch=original;}
});
