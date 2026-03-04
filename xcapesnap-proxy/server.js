// ============================================
// XCAPESNAP PRO ACTIVATION TEST SCRIPT
// ============================================
// Paste this into your browser console to test Pro activation
// WITHOUT making a real PayPal payment!

(async function testProActivation() {
  console.log('🧪 Starting Pro activation test...');
  
  // Get current user ID
  const userID = localStorage.getItem('xs_userid');
  
  if (!userID) {
    console.error('❌ No user ID found! Please load the app first.');
    return;
  }
  
  console.log('📋 User ID:', userID);
  
  // Call test endpoint to activate Pro
  try {
    const response = await fetch('https://xcapesnap-app.onrender.com/test-activate-pro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userID })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Pro activated successfully!');
      console.log('🔄 Checking Pro status from backend...');
      
      // Verify Pro status
      const checkResponse = await fetch(`https://xcapesnap-app.onrender.com/check-pro?userid=${userID}`);
      const checkData = await checkResponse.json();
      
      if (checkData.isPro) {
        console.log('✅ Backend confirms Pro status: ACTIVE');
        
        // Update local storage
        localStorage.setItem('xs_pro', 'true');
        console.log('✅ Local storage updated');
        
        // Reload page to show Pro UI
        console.log('🔄 Reloading page to show Pro features...');
        setTimeout(() => location.reload(), 1000);
      } else {
        console.error('❌ Backend says Pro is NOT active - something went wrong!');
      }
    } else {
      console.error('❌ Activation failed:', data);
    }
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  }
})();
