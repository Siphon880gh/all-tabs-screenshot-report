function setBusy(busy, message = "") {
  document.getElementById("btn-with-screenshots").disabled = busy;
  document.getElementById("btn-without-screenshots").disabled = busy;

  const status = document.getElementById("popup-status");
  if (message) {
    status.textContent = message;
    status.hidden = false;
  } else {
    status.hidden = true;
    status.textContent = "";
  }
}

function startReport(includeScreenshots) {
  setBusy(true, "Generating report…");

  chrome.runtime.sendMessage(
    { action: "buildReport", includeScreenshots },
    (response) => {
      if (chrome.runtime.lastError) {
        setBusy(false, chrome.runtime.lastError.message);
        return;
      }

      if (response?.ok) {
        window.close();
        return;
      }

      setBusy(false, response?.error || "Report failed");
    }
  );
}

document.getElementById("btn-with-screenshots").addEventListener("click", () => {
  startReport(true);
});

document.getElementById("btn-without-screenshots").addEventListener("click", () => {
  startReport(false);
});
