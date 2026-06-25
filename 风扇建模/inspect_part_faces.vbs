Option Explicit

Dim swApp, swModel, swPart
Dim vBodies, swBody, vBodyBox, bodyItem
Dim vFaces, swFace, swSurface, vFaceBox, vEval
Dim i

Function ArrStr(arr)
    Dim j, s
    s = ""
    For j = LBound(arr) To UBound(arr)
        If j > LBound(arr) Then s = s & ","
        s = s & CStr(arr(j))
    Next
    ArrStr = s
End Function

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

Set swPart = swModel
vBodies = swPart.GetBodies2(0, False)
WScript.Echo "BODIES_TYPENAME=" & TypeName(vBodies)
If IsEmpty(vBodies) Then
    WScript.Echo "BODIES=EMPTY"
    WScript.Quit 3
End If

If IsArray(vBodies) Then
    For Each bodyItem In vBodies
        Set swBody = bodyItem
        Exit For
    Next
Else
    Set swBody = vBodies
End If
vBodyBox = swBody.GetBodyBox
WScript.Echo "BODY_BOX=" & ArrStr(vBodyBox)

vFaces = swBody.GetFaces
WScript.Echo "FACES_TYPENAME=" & TypeName(vFaces)
WScript.Echo "FACE_COUNT=" & (UBound(vFaces) - LBound(vFaces) + 1)

For i = LBound(vFaces) To UBound(vFaces)
    Set swFace = vFaces(i)
    Set swSurface = swFace.GetSurface
    vFaceBox = swFace.GetBox
    WScript.Echo "FACE[" & i & "].AREA=" & swFace.GetArea
    WScript.Echo "FACE[" & i & "].BOX=" & ArrStr(vFaceBox)
    If swSurface.IsPlane Then
        vEval = swSurface.Evaluate(0, 0, 0, 0)
        WScript.Echo "FACE[" & i & "].PLANE=" & ArrStr(vEval)
    Else
        WScript.Echo "FACE[" & i & "].PLANE=NO"
    End If
Next
