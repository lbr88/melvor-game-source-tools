export function setup(ctx) {
  ctx.patch(Bank.prototype, 'sortItems').after(function afterBankSort() {
    console.log('fixture optimizer saw bank sort');
  });

  const menu = typeof bankTabMenu !== 'undefined' ? bankTabMenu : globalThis.bankTabMenu;
  return menu;
}
