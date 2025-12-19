/**
 * 测试自动语言检测功能的脚本
 * 在浏览器开发者控制台中运行
 */

console.log('=== 测试自动语言检测 ===');
console.log('浏览器语言列表:', navigator.languages || [navigator.language]);
console.log('当前 i18n 语言:', i18n.currentLanguage);
console.log('localStorage 中保存的语言:', localStorage.getItem('language'));

console.log('\n=== 测试语言检测方法 ===');
const detectedLang = i18n.detectBrowserLanguage();
console.log('检测到的语言:', detectedLang);

console.log('\n=== 验证语言选择 ===');
const langSelect = document.getElementById('languageSetting');
if (langSelect) {
    console.log('语言选择框当前值:', langSelect.value);
    console.log('语言选择框所有选项:');
    Array.from(langSelect.options).forEach(opt => {
        console.log(`  ${opt.value}: ${opt.textContent}`);
    });
}

console.log('\n✅ 自动语言检测测试完成！');
