import { expect, type Page } from '@playwright/test';

export async function feature(page: Page, tab: string) {
  const nav = page.getByRole('navigation', {name:'Chức năng nhóm môn'});
  await expect(nav).toBeVisible();
  if(['assignments','reports'].includes(tab)&&await nav.getByRole('button',{name:'Danh sách sinh viên',exact:true}).count())tab='students';
  const primary = nav.locator(`[data-campaign-tab="${tab}"]`);
  if (await primary.count()) await primary.click();
  else if(tab==='chat'&&await page.locator('header a[href="#/chat"]').count())await page.locator('header a[href="#/chat"]').click();
  else {
  await nav.getByRole('button', {name:'Thêm chức năng', exact:true}).click();
  await page.getByRole('dialog', {name:'Chức năng', exact:true}).locator(`[data-campaign-tab="${tab}"]`).click();
  }
  await expect(page).toHaveURL(new RegExp('(?:[?&])tab='+tab+'(?:&|$)'));
}
export async function applyFilters(page: Page, values: Record<string, string | {label:string}>) {
  await page.getByRole('button', {name:/^Bộ lọc(?: \(\d+\))?$/}).click();
  const dialog = page.getByRole('dialog', {name:'Bộ lọc danh sách'});
  for (const [name, value] of Object.entries(values)) await dialog.getByLabel(name, {exact:true}).selectOption(value);
  await dialog.getByRole('button', {name:'Áp dụng', exact:true}).click();
}
