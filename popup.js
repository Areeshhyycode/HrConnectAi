// popup.js — runs every time the popup is opened



console.log("HRConnect AI popup opened");



// 1. Grab the elements from the DOM using their IDs
const statusEl = document.getElementById("status");
const testBtn = document.getElementById("testBtn");

// 2. Listen for clicks on the button
testBtn.addEventListener("click", () => {
  statusEl.textContent = "✅ JavaScript is working! Ready to build.";
  statusEl.style.background = "#dcfce7";
});