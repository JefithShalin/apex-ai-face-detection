(function () {

  var MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

  var stream         = null;
  var faceMatcher    = null;
  var modelsReady    = false;
  var pendingAttType = null;
  var processing     = false;

  var video     = document.getElementById('attVideo');
  var canvas    = document.getElementById('attCanvas');
  var btnCam    = document.getElementById('btnAttCam');
  var btnIn     = document.getElementById('btnAttIn');
  var btnOut    = document.getElementById('btnAttOut');
  var statusDiv = document.getElementById('attStatus');

  function setStatus(msg, color) {
    statusDiv.innerHTML  = msg;
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
        setStatus('face-api.js not loaded. Check File URLs.', '#ff6666');
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
        return loadRegisteredFaces();
      }).catch(function (err) {
        setStatus('Model load failed: ' + err.message, '#ff6666');
        console.error(err);
      });
    });
  }

  function loadRegisteredFaces() {
    setStatus('Loading registered faces from DB...', '#ffcc00');
    apex.server.process('GET_FACES', {}, {
      success: function (data) {
        var faces;
        try { faces = (typeof data === 'string') ? JSON.parse(data) : data; }
        catch (e) { setStatus('Bad JSON from GET_FACES', '#ff6666'); return; }

        if (!faces || faces.length === 0) {
          setStatus('No registered faces. Please register first.', '#ffcc00');
          btnCam.disabled = false;
          return;
        }

        var labeled = faces.map(function (f) {
          var arr = (typeof f.FACE_DESCRIPTOR === 'string')
                    ? JSON.parse(f.FACE_DESCRIPTOR)
                    : f.FACE_DESCRIPTOR;
          return new faceapi.LabeledFaceDescriptors(
            f.EMP_ID + '|' + f.EMP_CODE + '|' + f.EMP_NAME,
            [new Float32Array(arr)]
          );
        });

        faceMatcher = new faceapi.FaceMatcher(labeled, 0.5);
        btnCam.disabled = false;
        setStatus(faces.length + ' face(s) loaded. Click Start Camera.');
        loadTodayLog();
      },
      error: function (xhr, status, err) {
        setStatus('GET_FACES failed: ' + (err || status), '#ff6666');
      }
    });
  }

  function startCamera() {
    btnCam.disabled = true;
    setStatus('Starting camera...', '#ffcc00');
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        video.onloadedmetadata = function () {
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          video.play();
          btnIn.disabled  = false;
          btnOut.disabled = false;
          setStatus('Camera live. Click Mark IN or Mark OUT then look at camera.');
          startDetectionLoop();
        };
      })
      .catch(function (err) {
        btnCam.disabled = false;
        setStatus('Camera error: ' + err.message, '#ff6666');
      });
  }

  function startDetectionLoop() {
    var ctx = canvas.getContext('2d');
    setInterval(function () {
      if (video.readyState !== 4) return;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;

      faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors()
        .then(function (detections) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          detections.forEach(function (det) {
            var b     = det.detection.box;
            var match = faceMatcher ? faceMatcher.findBestMatch(det.descriptor) : null;
            var known = match && match.label !== 'unknown';
            var conf  = match ? ((1 - match.distance) * 100).toFixed(1) : 0;

            ctx.strokeStyle = known ? '#00ff88' : '#ff4444';
            ctx.lineWidth   = 3;
            ctx.strokeRect(b.x, b.y, b.width, b.height);
            ctx.fillStyle   = known ? '#00ff88' : '#ff4444';
            ctx.font        = 'bold 13px Arial';

            var label = known
              ? (match.label.split('|')[2] + ' (' + conf + '%)')
              : 'Unknown';
            ctx.fillText(label, b.x, b.y > 18 ? b.y - 6 : b.y + 18);

            if (known && pendingAttType && !processing) {
              processing = true;
              var parts = match.label.split('|');
              saveAttendance(parts[0], parts[1], parts[2], conf, pendingAttType);
              pendingAttType = null;
            }
          });
        });
    }, 500);
  }

  function saveAttendance(empId, empCode, empName, conf, attType) {
    setStatus('Marking ' + attType + ' for ' + empName + '...', '#ffcc00');
    btnIn.disabled  = true;
    btnOut.disabled = true;

    apex.server.process('MARK_ATT', {
      x01: empId, x02: empCode, x03: empName,
      x04: attType, x05: conf
    }, {
      success: function () {
        setStatus(empName + ' marked ' + attType + ' (' + conf + '% match)');
        btnIn.disabled  = false;
        btnOut.disabled = false;
        processing      = false;
        loadTodayLog();
      },
      error: function (xhr, status, err) {
        setStatus('Save error: ' + (err || status), '#ff6666');
        btnIn.disabled  = false;
        btnOut.disabled = false;
        processing      = false;
      }
    });
  }

  function loadTodayLog() {
    apex.server.process('GET_TODAY_ATT', {}, {
      success: function (data) {
        var rows;
        try { rows = (typeof data === 'string') ? JSON.parse(data) : data; }
        catch (e) { return; }
        if (!rows || rows.length === 0) {
          document.getElementById('attLog').innerHTML =
            '<p style="color:#666;text-align:center;margin-top:10px;">No attendance recorded today.</p>';
          return;
        }
        var html = '<table><tr><th>Name</th><th>Code</th><th>Time</th><th>Type</th><th>Confidence</th></tr>';
        rows.forEach(function (r) {
          html += '<tr><td>' + r.EMP_NAME + '</td><td>' + r.EMP_CODE +
            '</td><td>' + r.ATT_TIME + '</td><td style="color:' +
            (r.ATT_TYPE==='IN' ? '#00ff88' : '#ff5555') + ';font-weight:bold;">' +
            r.ATT_TYPE + '</td><td>' + r.CONFIDENCE + '%</td></tr>';
        });
        html += '</table>';
        document.getElementById('attLog').innerHTML = html;
      }
    });
  }

  btnCam.addEventListener('click', startCamera);
  btnIn.addEventListener('click',  function () { pendingAttType = 'IN';  setStatus('Look at camera for IN mark...', '#ffcc00'); });
  btnOut.addEventListener('click', function () { pendingAttType = 'OUT'; setStatus('Look at camera for OUT mark...', '#ffcc00'); });

  loadModels();

}());
