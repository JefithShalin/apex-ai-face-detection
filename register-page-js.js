(function () {

  var MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

  var stream            = null;
  var detectionTimer    = null;
  var currentDescriptor = null;
  var modelsReady       = false;

  var video      = document.getElementById('regVideo');
  var canvas     = document.getElementById('regCanvas');
  var btnStart   = document.getElementById('btnStartCam');
  var btnCapture = document.getElementById('btnCapture');
  var statusDiv  = document.getElementById('regStatus');

  function setStatus(msg, color) {
    statusDiv.innerHTML = msg;
    statusDiv.style.color = color || '#a0ffa0';
  }

  function waitForFaceApi(cb) {
    if (typeof faceapi !== 'undefined') { cb(); return; }
    var t = 0;
    var iv = setInterval(function () {
      t += 200;
      if (typeof faceapi !== 'undefined') { clearInterval(iv); cb(); }
      else if (t > 10000) {
        clearInterval(iv);
        setStatus('face-api.js failed to load. Check File URLs setting.', '#ff6666');
      }
    }, 200);
  }

  function loadModels() {
    setStatus('Loading AI models...');
    waitForFaceApi(function () {
      Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]).then(function () {
        modelsReady = true;
        btnStart.disabled = false;
        setStatus('Ready. Click Start Camera.');
      }).catch(function (err) {
        setStatus('Model error: ' + err.message, '#ff6666');
        console.error('Model load error', err);
      });
    });
  }

  function startCamera() {
    if (!modelsReady) { setStatus('Models still loading...', '#ffcc00'); return; }
    btnStart.disabled = true;
    setStatus('Requesting camera...', '#ffcc00');

    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        video.onloadedmetadata = function () {
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          video.play();
          btnCapture.disabled = false;
          setStatus('Camera live. Position your face in the box.');
          startDetection();
        };
      })
      .catch(function (err) {
        btnStart.disabled = false;
        setStatus('Camera denied: ' + err.message, '#ff6666');
      });
  }

  function startDetection() {
    var ctx = canvas.getContext('2d');
    detectionTimer = setInterval(function () {
      if (video.readyState !== 4) return;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;

      faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor()
        .then(function (det) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (det) {
            currentDescriptor = det.descriptor;
            var b = det.detection.box;
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth   = 3;
            ctx.strokeRect(b.x, b.y, b.width, b.height);
            ctx.fillStyle   = '#00ff88';
            ctx.font        = 'bold 13px Arial';
            ctx.fillText('Face Detected', b.x + 2, b.y > 18 ? b.y - 6 : b.y + 18);
          } else {
            currentDescriptor = null;
          }
        });
    }, 400);
  }

  function captureFace() {
    var name = document.getElementById('regEmpName').value.trim();
    var code = document.getElementById('regEmpCode').value.trim();
    var dept = document.getElementById('regEmpDept').value.trim();

    if (!name || !code) { setStatus('Name and Code are required', '#ffcc00'); return; }
    if (!currentDescriptor) { setStatus('No face detected.', '#ffcc00'); return; }

    btnCapture.disabled = true;
    setStatus('Saving to database...', '#ffcc00');

    apex.server.process('SAVE_FACE', {
      x01: name, x02: code, x03: dept,
      x04: JSON.stringify(Array.from(currentDescriptor))
    }, {
      success: function (data) {
        setStatus(name + ' registered successfully!');
        document.getElementById('regEmpName').value = '';
        document.getElementById('regEmpCode').value = '';
        document.getElementById('regEmpDept').value = '';
        btnCapture.disabled = false;
      },
      error: function (xhr, status, err) {
        setStatus('DB save failed: ' + (err || status), '#ff6666');
        btnCapture.disabled = false;
      }
    });
  }

  btnStart.disabled = true;
  btnStart.addEventListener('click',   startCamera);
  btnCapture.addEventListener('click', captureFace);

  loadModels();

}());
