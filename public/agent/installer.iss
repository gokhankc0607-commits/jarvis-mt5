; Inno Setup 6 — JARVIS kurulum paketi
; Derleme: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss  (önce build_exe.bat)
#define AppName "JARVIS"
#define AppVersion "2.9.0"

[Setup]
AppId={{6E1B7A52-4C2D-4B7E-9A3F-1A2B3C4D5E6F}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=JARVIS
DefaultDirName={localappdata}\JARVIS
DefaultGroupName=JARVIS
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=JARVIS-Setup
#ifexist "jarvis.ico"
SetupIconFile=jarvis.ico
#endif
UninstallDisplayIcon={app}\JARVIS.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolu oluştur"; GroupDescription: "Kısayollar:"
Name: "autostart"; Description: "Windows açılışında JARVIS'i başlat"; GroupDescription: "Başlangıç:"; Flags: unchecked

[Files]
Source: "dist\JARVIS\*"; DestDir: "{app}"; Excludes: "config.json"; Flags: ignoreversion recursesubdirs createallsubdirs
; config.json kullanıcıya aittir — güncellemede ezilmez
Source: "dist\JARVIS\config.json"; DestDir: "{app}"; Flags: onlyifdoesntexist skipifsourcedoesntexist

[Icons]
#ifexist "jarvis.ico"
Name: "{group}\JARVIS"; Filename: "{app}\JARVIS.exe"; WorkingDir: "{app}"; IconFilename: "{app}\jarvis.ico"
#else
Name: "{group}\JARVIS"; Filename: "{app}\JARVIS.exe"; WorkingDir: "{app}"
#endif
Name: "{group}\JARVIS Kurulum Sihirbazı"; Filename: "{app}\JARVIS.exe"; Parameters: "--setup"; WorkingDir: "{app}"
Name: "{group}\JARVIS (sessiz mod)"; Filename: "{app}\JARVIS.exe"; Parameters: "--no-voice"; WorkingDir: "{app}"
Name: "{group}\JARVIS'i Kaldır"; Filename: "{uninstallexe}"
Name: "{autodesktop}\JARVIS"; Filename: "{app}\JARVIS.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\JARVIS"; Filename: "{app}\JARVIS.exe"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\JARVIS.exe"; Description: "JARVIS'i şimdi başlat"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
