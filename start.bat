@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 啟動本機測試伺服器： http://localhost:8123/
echo 關閉此視窗即停止伺服器。
start "" http://localhost:8123/
python -m http.server 8123 --bind 127.0.0.1
if errorlevel 1 (
  echo python 未找到，改用 py 啟動...
  py -m http.server 8123 --bind 127.0.0.1
)
pause
