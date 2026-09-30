# PurpleCallio Android SDK consumer rules.
# WebRTC uses JNI callbacks into these classes.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**
# Socket.IO / Engine.IO client
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-dontwarn okhttp3.**
-dontwarn okio.**
