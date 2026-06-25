Option Explicit

Dim swApp
Dim swModel

On Error Resume Next
Set swApp = GetObject(, "SldWorks.Application")
If Err.Number <> 0 Then
    WScript.Echo "GET_APP_ERROR=" & Err.Description
    WScript.Quit 1
End If
On Error GoTo 0

Set swModel = swApp.ActiveDoc
If swModel Is Nothing Then
    WScript.Echo "ACTIVE_DOC=NULL"
    WScript.Quit 2
End If

WScript.Echo "TITLE=" & swModel.GetTitle
