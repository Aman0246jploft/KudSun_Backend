// Test script for language-based notification translation
// This script demonstrates how the notification system now supports Thai language translations

const { translateNotification, extractNotificationVariables, isLanguageSupported } = require('../utils/notificationTranslations');

console.log('🔤 Testing Notification Translation System\n');

// Test cases for different notification scenarios
const testCases = [
  {
    scenario: 'Order Confirmed (English)',
    title: 'Order Confirmed',
    message: 'Your order #{{orderNumber}} has been confirmed and will be shipped soon!',
    language: 'english',
    variables: { orderNumber: '12345' }
  },
  {
    scenario: 'Order Confirmed (Thai)',
    title: 'Order Confirmed',
    message: 'Your order #{{orderNumber}} has been confirmed and will be shipped soon!',
    language: 'thi',
    variables: { orderNumber: '12345' }
  },
  {
    scenario: 'Product Liked (English)',
    title: 'Someone liked your product!',
    message: 'Your {{productName}} listing received a new like.',
    language: 'english',
    variables: { productName: 'iPhone 13 Pro' }
  },
  {
    scenario: 'Product Liked (Thai)',
    title: 'Someone liked your product!',
    message: 'Your {{productName}} listing received a new like.',
    language: 'thi',
    variables: { productName: 'iPhone 13 Pro' }
  },
  {
    scenario: 'Product Deactivated (English)',
    title: 'Your Product Has Been Deactivated',
    message: 'An admin has deactivated your product "{{productTitle}}".',
    language: 'english',
    variables: { productTitle: 'MacBook Pro 2023' }
  },
  {
    scenario: 'Product Deactivated (Thai)',
    title: 'Your Product Has Been Deactivated',
    message: 'An admin has deactivated your product "{{productTitle}}".',
    language: 'thi',
    variables: { productTitle: 'MacBook Pro 2023' }
  },
  {
    scenario: 'Review Notification (English)',
    title: 'reviewed your Item',
    message: '{{rating}}-star review: "{{reviewText}}"',
    language: 'english',
    variables: { rating: 5, reviewText: 'Excellent product, fast shipping!' }
  },
  {
    scenario: 'Review Notification (Thai)',
    title: 'reviewed your Item',
    message: '{{rating}}-star review: "{{reviewText}}"',
    language: 'thi',
    variables: { rating: 5, reviewText: 'สินค้าดีมาก จัดส่งเร็ว!' }
  },
  {
    scenario: 'New Message (English)',
    title: 'New Message',
    message: 'You have received a new message from a buyer interested in your product.',
    language: 'english',
    variables: {}
  },
  {
    scenario: 'New Message (Thai)',
    title: 'New Message',
    message: 'You have received a new message from a buyer interested in your product.',
    language: 'thi',
    variables: {}
  }
];

// Run test cases
testCases.forEach((testCase, index) => {
  console.log(`📱 Test ${index + 1}: ${testCase.scenario}`);
  console.log(`   Language: ${testCase.language}`);
  
  const translatedTitle = translateNotification(testCase.title, testCase.language, testCase.variables);
  const translatedMessage = translateNotification(testCase.message, testCase.language, testCase.variables);
  
  console.log(`   Original Title: "${testCase.title}"`);
  console.log(`   Translated Title: "${translatedTitle}"`);
  console.log(`   Original Message: "${testCase.message}"`);
  console.log(`   Translated Message: "${translatedMessage}"`);
  console.log('');
});

// Test language support check
console.log('🌍 Language Support Tests:');
console.log(`   English supported: ${isLanguageSupported('english')}`);
console.log(`   Thai supported: ${isLanguageSupported('thi')}`);
console.log(`   French supported: ${isLanguageSupported('french')}`);
console.log('');

// Test variable extraction
console.log('🔧 Variable Extraction Test:');
const sampleMeta = {
  orderNumber: 'ORD-2023-001',
  productTitle: 'Gaming Laptop',
  rating: 4,
  reviewText: 'Good product but delivery was slow',
  trackingNumber: 'TRK123456789'
};

const extractedVars = extractNotificationVariables('Sample message', sampleMeta);
console.log('   Sample Meta:', sampleMeta);
console.log('   Extracted Variables:', extractedVars);
console.log('');

// Test fallback behavior
console.log('🛡️  Fallback Behavior Tests:');
const unknownText = 'This text is not in the translation table';
const englishFallback = translateNotification(unknownText, 'english');
const thaiFallback = translateNotification(unknownText, 'thi');
const unsupportedLangFallback = translateNotification('Order Confirmed', 'spanish');

console.log(`   Unknown text (English): "${englishFallback}"`);
console.log(`   Unknown text (Thai): "${thaiFallback}"`);
console.log(`   Known text (Unsupported language): "${unsupportedLangFallback}"`);
console.log('');

console.log('✅ Notification Translation Tests Completed!');
console.log('');
console.log('💡 Usage in your application:');
console.log('   1. User language is stored in User.language field');
console.log('   2. notificationProcessor automatically translates based on user preference');
console.log('   3. Supports English ("english") and Thai ("thi") languages');
console.log('   4. Falls back to English for unsupported languages');
console.log('   5. Handles variable replacement ({{variableName}}) in translations');
