!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\VerdBoard\Capabilities" "ApplicationName" "VerdBoard"
  WriteRegStr SHELL_CONTEXT "Software\VerdBoard\Capabilities" "ApplicationDescription" "Markdown and VerdBoard canvas editor"
  WriteRegStr SHELL_CONTEXT "Software\VerdBoard\Capabilities\FileAssociations" ".md" "VerdBoard.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\VerdBoard\Capabilities\FileAssociations" ".markdown" "VerdBoard.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\VerdBoard\Capabilities\FileAssociations" ".verd" "VerdBoard.Canvas"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "VerdBoard" "Software\VerdBoard\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "VerdBoard"
  DeleteRegKey SHELL_CONTEXT "Software\VerdBoard\Capabilities"
!macroend
