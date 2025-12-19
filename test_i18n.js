/**
 * 多语言功能快速测试脚本
 * 在浏览器控制台中运行此脚本以测试所有多语言功能
 */

// 测试 i18n 模块
console.log('=== 测试 i18n 模块 ===');
console.log('当前语言:', i18n.currentLanguage);
console.log('可用语言:', i18n.getAvailableLanguages());

// 测试导航栏翻译键
console.log('\n=== 导航栏翻译 ===');
console.log('nav.queue:', i18n.t('nav.queue'));
console.log('nav.local:', i18n.t('nav.local'));
console.log('nav.ranking:', i18n.t('nav.ranking'));
console.log('nav.search:', i18n.t('nav.search'));
console.log('nav.settings:', i18n.t('nav.settings'));
console.log('nav.debug:', i18n.t('nav.debug'));

// 测试排行页面翻译键
console.log('\n=== 排行页面翻译 ===');
console.log('ranking.title:', i18n.t('ranking.title'));
console.log('ranking.all:', i18n.t('ranking.all'));
console.log('ranking.week:', i18n.t('ranking.week'));
console.log('ranking.month:', i18n.t('ranking.month'));
console.log('ranking.empty:', i18n.t('ranking.empty'));
console.log('ranking.play:', i18n.t('ranking.play'));

// 测试设置页面翻译键
console.log('\n=== 设置页面翻译 ===');
console.log('settings.title:', i18n.t('settings.title'));
console.log('settings.theme:', i18n.t('settings.theme'));
console.log('settings.language:', i18n.t('settings.language'));

// 测试英文翻译
console.log('\n=== 英文翻译 ===');
console.log('nav.queue (en):', i18n.t('nav.queue', 'en'));
console.log('ranking.title (en):', i18n.t('ranking.title', 'en'));
console.log('settings.title (en):', i18n.t('settings.title', 'en'));

// 测试导航栏元素是否正确显示
console.log('\n=== 导航栏 DOM 检查 ===');
const navLabels = document.querySelectorAll('.nav-item .nav-label');
navLabels.forEach((label, index) => {
    console.log(`导航项 ${index}:`, label.textContent);
});

// 测试排行页面元素
console.log('\n=== 排行页面 DOM 检查 ===');
const rankingTitle = document.querySelector('#rankingModal .modal-title');
if (rankingTitle) {
    console.log('排行标题:', rankingTitle.textContent);
}
const rankingTabs = document.querySelectorAll('.ranking-tab');
rankingTabs.forEach(tab => {
    console.log('排行标签 (' + tab.getAttribute('data-period') + '):', tab.textContent);
});

console.log('\n✅ 多语言功能测试完成！');
