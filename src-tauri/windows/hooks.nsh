!define GXT_EXT ".gxt"
; ProgID 建议用“反向域名 + 类型”，避免和别人撞车
!define GXT_PROGID "com.root.gxteditor.AssocFile.GXT"

; Capabilities 注册路径（按“当前用户”写 HKCU）
!define CAPA_ROOT "Software\com.root.gxteditor\Capabilities"
!define REGAPPS_ROOT "Software\RegisteredApplications"

!macro NSIS_HOOK_POSTINSTALL

  ; 1) ProgID：描述、图标、open 命令
  WriteRegStr HKCU "Software\Classes\${GXT_PROGID}" "" "GXT Key-Value File"
  WriteRegStr HKCU "Software\Classes\${GXT_PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"

  ; 注意：命令行里要带引号，NSIS 内嵌引号用 $\" 更稳
  WriteRegStr HKCU "Software\Classes\${GXT_PROGID}\shell\open\command" "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  ; 2) 扩展名 -> ProgID（这一步在新装/未设置默认时通常就会生效）
  WriteRegStr HKCU "Software\Classes\${GXT_EXT}" "" "${GXT_PROGID}"

  ; 让它也出现在“打开方式”候选里（可选）
  WriteRegStr HKCU "Software\Classes\${GXT_EXT}\OpenWithProgids" "${GXT_PROGID}" ""
  ; OpenWithProgids 的语义就是：声明“这些 ProgID 也能打开该扩展名”。:contentReference[oaicite:9]{index=9}

  ; 3) Default Programs / Capabilities：让 Windows 默认应用 UI 能看到你
  WriteRegStr HKCU "${CAPA_ROOT}" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr HKCU "${CAPA_ROOT}" "ApplicationDescription" "Edit .gxt key/value files"
  WriteRegStr HKCU "${CAPA_ROOT}\FileAssociations" "${GXT_EXT}" "${GXT_PROGID}"

  WriteRegStr HKCU "${REGAPPS_ROOT}" "${PRODUCTNAME}" "${CAPA_ROOT}"

  ; 4) 通知系统“文件关联变了”，让资源管理器/系统刷新
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'

!macroend


!macro NSIS_HOOK_PREUNINSTALL

  ; 卸载时清理（按需；不建议粗暴删 .gxt 整体，因为可能用户装了别的软件也声明了 .gxt）
  DeleteRegKey HKCU "Software\Classes\${GXT_PROGID}"
  DeleteRegValue HKCU "Software\Classes\${GXT_EXT}\OpenWithProgids" "${GXT_PROGID}"

  ; 如果你确实把 .gxt 的默认值指到了你这里，并且想卸载时撤回，可以考虑：
  ; DeleteRegValue HKCU "Software\Classes\${GXT_EXT}" ""

  DeleteRegKey HKCU "Software\com.root.gxteditor"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCTNAME}"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'

!macroend
