import React, { useEffect, useMemo, useState } from "react";
import heroImage from "./assets/Illustration.png";
import CallScreen from "./CallScreen";

const createRoomId = () => crypto.randomUUID().slice(0, 8);

function App() {
  const getRoomFromUrl = () => new URLSearchParams(window.location.search).get("room");

  const [roomId, setRoomId] = useState(() => getRoomFromUrl());
  const [inCall, setInCall] = useState(() => Boolean(getRoomFromUrl()));

  useEffect(() => {
    const handlePopState = () => {
      const nextRoom = getRoomFromUrl();
      setRoomId(nextRoom);
      setInCall(Boolean(nextRoom));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const joinLink = useMemo(() => {
    if (!roomId) {
      return "";
    }

    return `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  }, [roomId]);

  const openCall = (nextRoomId) => {
    const nextUrl = `${window.location.pathname}?room=${nextRoomId}`;
    window.history.pushState({}, "", nextUrl);
    setRoomId(nextRoomId);
    setInCall(true);
  };

  const handleCreateCall = () => {
    openCall(createRoomId());
  };

  const handleJoinRoom = () => {
    const typedRoom = window.prompt("Enter the room code");

    if (!typedRoom) {
      return;
    }

    openCall(typedRoom.trim());
  };

  const handleEndCall = () => {
    window.history.pushState({}, "", window.location.pathname);
    setInCall(false);
    setRoomId(null);
  };

  return (
    <section className="flex flex-col min-h-screen items-center justify-center bg-[#777dc6] px-6">
      {!inCall ? (
        <>
          <h1 className="text-white font-semibold mb-8 text-4xl text-center">
            Interactive Document Picture-in-Picture Meeting UI Prototype
          </h1>
          <div className="rounded-2xl border border-white/20 bg-white/10 w-full max-w-3xl shadow-2xl backdrop-blur p-8">
            <div className="flex flex-col items-center gap-6">
              <img src={heroImage} alt="hero-img" width={280} />
              <div className="flex gap-3">
                <button
                  onClick={handleCreateCall}
                  className="rounded-lg bg-white px-6 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
                >
                  Create Call Link
                </button>
                <button
                  onClick={handleJoinRoom}
                  className="rounded-lg border border-white px-6 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Join With Code
                </button>
              </div>
              {joinLink && (
                <div className="w-full rounded-xl bg-white/15 p-4 text-white">
                  <p className="text-sm font-semibold">Share this join link</p>
                  <p className="mt-2 break-all text-sm">{joinLink}</p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <CallScreen endCall={handleEndCall} roomId={roomId} joinLink={joinLink} />
      )}
    </section>
  );
}

export default App;
