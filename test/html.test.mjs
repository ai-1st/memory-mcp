import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, confluenceStorageToText } from '../src/lib/html.js';

// The regex that the bug report asks us to assert never matches post-fix.
const GARBAGE_RE = /(?:bash|plain text|java|yaml|sql)?wide\d{3}/i;

describe('confluenceStorageToText — code macros', () => {
  it('preserves a code macro body as a fenced block with its language', () => {
    const xml = `
      <ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">bash</ac:parameter>
        <ac:parameter ac:name="layout">wide</ac:parameter>
        <ac:parameter ac:name="width">760</ac:parameter>
        <ac:plain-text-body><![CDATA[$ lc_status lithosphere.qa
$ lc_restart lithosphere.qa]]></ac:plain-text-body>
      </ac:structured-macro>`;

    const out = confluenceStorageToText(xml);

    assert.match(out, /```bash/);
    assert.match(out, /\$ lc_status lithosphere\.qa/);
    assert.match(out, /\$ lc_restart lithosphere\.qa/);
    assert.match(out, /```\s*$/); // closing fence
  });

  it('drops layout/width params instead of leaking "bashwide760"', () => {
    const xml = `
      <p>Basic Command Structure</p>
      <ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">bash</ac:parameter>
        <ac:parameter ac:name="layout">wide</ac:parameter>
        <ac:parameter ac:name="width">760</ac:parameter>
        <ac:plain-text-body><![CDATA[lc_status]]></ac:plain-text-body>
      </ac:structured-macro>
      <p>The RC console loads the appropriate VTL template</p>`;

    const out = confluenceStorageToText(xml);

    assert.doesNotMatch(out, GARBAGE_RE);
    assert.doesNotMatch(out, /bashwide760/);
    assert.match(out, /Basic Command Structure/);
    assert.match(out, /VTL template/);
  });

  it('does not fuse a code block with adjacent list numbers', () => {
    const xml = `
      <ol>
        <li>Environment Setup
          <ac:structured-macro ac:name="code">
            <ac:parameter ac:name="language">bash</ac:parameter>
            <ac:parameter ac:name="layout">wide</ac:parameter>
            <ac:parameter ac:name="width">760</ac:parameter>
            <ac:plain-text-body><![CDATA[setup.sh]]></ac:plain-text-body>
          </ac:structured-macro>
        </li>
        <li>Community Connection</li>
      </ol>`;

    const out = confluenceStorageToText(xml);

    assert.doesNotMatch(out, /bashwide7602/);
    assert.doesNotMatch(out, GARBAGE_RE);
    assert.match(out, /setup\.sh/);
    assert.match(out, /Community Connection/);
  });

  it('uses no fence language for "plain text" and keeps the body', () => {
    const xml = `
      <ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">plain text</ac:parameter>
        <ac:parameter ac:name="layout">wide</ac:parameter>
        <ac:parameter ac:name="width">760</ac:parameter>
        <ac:plain-text-body><![CDATA[some literal output]]></ac:plain-text-body>
      </ac:structured-macro>`;

    const out = confluenceStorageToText(xml);

    assert.doesNotMatch(out, /plain textwide760/);
    assert.doesNotMatch(out, GARBAGE_RE);
    assert.match(out, /```\nsome literal output\n```/);
  });

  it('keeps angle brackets inside a code body (not stripped as tags)', () => {
    const xml = `
      <ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">xml</ac:parameter>
        <ac:plain-text-body><![CDATA[<config><port>8080</port></config>]]></ac:plain-text-body>
      </ac:structured-macro>`;

    const out = confluenceStorageToText(xml);

    assert.match(out, /<config><port>8080<\/port><\/config>/);
  });
});

describe('confluenceStorageToText — structural macros', () => {
  it('drops the TOC macro params (no "12truenonelisttrue")', () => {
    const xml = `
      <ac:structured-macro ac:name="toc">
        <ac:parameter ac:name="maxLevel">2</ac:parameter>
        <ac:parameter ac:name="printable">true</ac:parameter>
        <ac:parameter ac:name="style">none</ac:parameter>
        <ac:parameter ac:name="type">list</ac:parameter>
        <ac:parameter ac:name="outline">true</ac:parameter>
      </ac:structured-macro>
      <p>Real body text.</p>`;

    const out = confluenceStorageToText(xml);

    assert.doesNotMatch(out, /truenonelist/);
    assert.doesNotMatch(out, /12truenonelisttrue/);
    assert.match(out, /Real body text\./);
  });
});

describe('confluenceStorageToText — tables', () => {
  it('renders a table as Markdown with a header separator', () => {
    const xml = `
      <table>
        <tbody>
          <tr><th>Observed</th><th>Meaning</th></tr>
          <tr><td>bash</td><td>language</td></tr>
        </tbody>
      </table>`;

    const out = confluenceStorageToText(xml);

    assert.match(out, /\| Observed \| Meaning \|/);
    assert.match(out, /\| --- \| --- \|/);
    assert.match(out, /\| bash \| language \|/);
  });
});

describe('htmlToText — rendered HTML (Jira path) unaffected', () => {
  it('still converts basic rendered HTML to text', () => {
    const out = htmlToText('<h1>Title</h1><p>Hello <strong>world</strong></p>');
    assert.match(out, /Title/);
    assert.match(out, /Hello world/);
  });

  it('does not collide with numbers surrounded by spaces', () => {
    const out = htmlToText('<p>Upgrade to version 3 then reboot</p>');
    assert.match(out, /version 3 then reboot/);
  });
});
