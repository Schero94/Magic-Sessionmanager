async page => {
  const results = [];
  for (const [label, hint] of [['Provider', 'provider-hint'], ['Search', 'search-hint'], ['Template', 'template-hint']]) {
    const control = page.getByLabel(label, { exact: true });
    const hintNode = page.locator(`#${hint}`);
    const describedBy = await control.getAttribute('aria-describedby');
    if (!await hintNode.isVisible() || !describedBy?.split(' ').includes(hint)) {
      throw new Error(`${label}: missing visible, associated hint`);
    }
    const text = await hintNode.innerText();
    if (label === 'Provider' && (!text.includes('ipapi.co') || !text.includes('IP address'))) {
      throw new Error('Provider privacy disclosure is incomplete');
    }
    results.push({ label, describedBy, text });
  }
  if (await page.locator('#plain-hint').count()) throw new Error('Unexpected hint on plain field');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error('Page overflow');
  return results;
}
