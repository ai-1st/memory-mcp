#!/usr/bin/env node

const puppeteer = require('puppeteer');
const path = require('path');

async function takeScreenshot() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  
  console.log('Navigating to http://localhost:8787...');
  await page.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  
  console.log('Waiting 4 seconds for categories to load...');
  await new Promise(resolve => setTimeout(resolve, 4000));
  
  // Check page state
  const state = await page.evaluate(() => {
    const categories = document.querySelectorAll('.category-card');
    const toast = document.querySelector('#toast');
    const categoryNames = Array.from(categories).map(c => 
      c.querySelector('.cat-name')?.textContent
    );
    
    return {
      categoryCount: categories.length,
      categoryNames: categoryNames,
      toastText: toast ? toast.textContent : '',
      toastVisible: toast ? !toast.classList.contains('hidden') : false,
      toastClasses: toast ? toast.className : ''
    };
  });
  
  console.log('\nPage State:');
  console.log('  Categories loaded:', state.categoryCount);
  console.log('  Category names:', state.categoryNames.join(', '));
  console.log('  Toast visible:', state.toastVisible);
  if (state.toastVisible) {
    console.log('  Toast message:', state.toastText);
    console.log('  Toast type:', state.toastClasses.includes('error') ? 'ERROR' : 'SUCCESS');
  }
  
  const screenshotPath = path.join(__dirname, 'final-verification.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('\n✓ Screenshot saved:', screenshotPath);
  
  if (state.categoryCount === 3 && !state.toastVisible) {
    console.log('\n✅ SUCCESS: Categories loaded, no errors!');
  } else if (state.toastVisible && state.toastText.includes('Failed')) {
    console.log('\n❌ ERROR: "Failed to fetch" toast is visible');
  } else {
    console.log('\n⚠️  Unexpected state');
  }
  
  await browser.close();
}

takeScreenshot().catch(console.error);
