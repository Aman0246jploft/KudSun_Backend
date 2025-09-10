const { translateNotification, getUserLanguage, translateText } = require('./utils/translation');

// Test function to demonstrate translation functionality
async function testTranslation() {
  console.log('🧪 Testing Translation Functionality...\n');

  // Test 1: Basic text translation
  console.log('📝 Test 1: Basic Text Translation');
  try {
    const englishText = "Hello, welcome to our app!";
    const thaiTranslation = await translateText(englishText, 'thi');
    console.log(`English: ${englishText}`);
    console.log(`Thai: ${thaiTranslation}\n`);
  } catch (error) {
    console.error('Translation test failed:', error.message);
  }

  // Test 2: Notification translation
  console.log('📱 Test 2: Notification Translation');
  try {
    const sampleNotification = {
      title: "New Message",
      message: "You have received a new message from John",
      type: "message",
      userId: "test-user-id"
    };

    console.log('Original Notification:');
    console.log(`Title: ${sampleNotification.title}`);
    console.log(`Message: ${sampleNotification.message}`);

    const translatedNotification = await translateNotification(sampleNotification, 'thi');
    
    console.log('\nTranslated Notification (Thai):');
    console.log(`Title: ${translatedNotification.title}`);
    console.log(`Message: ${translatedNotification.message}`);
    console.log(`Original Title: ${translatedNotification.originalTitle}`);
    console.log(`Original Message: ${translatedNotification.originalMessage}\n`);
  } catch (error) {
    console.error('Notification translation test failed:', error.message);
  }

  // Test 3: Language mapping
  console.log('🌍 Test 3: Language Mapping');
  const testLanguages = ['english', 'thi', 'thai', 'en', 'th'];
  testLanguages.forEach(async (lang) => {
    try {
      const result = await translateText("Test message", lang);
      console.log(`${lang} -> ${result}`);
    } catch (error) {
      console.log(`${lang} -> Error: ${error.message}`);
    }
  });

  console.log('\n✅ Translation tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
  testTranslation().catch(console.error);
}

module.exports = { testTranslation };
