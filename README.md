# 🍾 Spin-n-Spill

> A real-time multiplayer Truth or Dare party game — no app download required.

Spin-n-Spill is a browser-based party game powered by Node.js and Socket.io. Friends join the same room from their own devices, spin a virtual bottle, and get hit with randomized Truth or Dare prompts — all in real time.

---

## Features

- **Real-time multiplayer** — all players in a room see the same spin, same result, same chaos, simultaneously
- **Room-based sessions** — create or join a room with a code; no accounts needed
- **Spin mechanic** — animated bottle spin determines whose turn it is
- **Truth or Dare prompts** — randomized prompts served up each round
- **Works on any device** — just a browser, no install

---

## Tech Stack

| Layer     | Technology          |
|-----------|---------------------|
| Runtime   | Node.js             |
| Server    | Express             |
| Real-time | Socket.io           |
| Frontend  | HTML, CSS, JS       |
| Config    | dotenv              |

---

## Getting Started

### Prerequisites

- Node.js v18+
- npm

### Installation

```bash
git clone https://github.com/Injora/Spin-n-Spill.git
cd Spin-n-Spill
npm install
```

### Configuration

Create a `.env` file in the root directory:

```env
PORT=3000
```

### Running the App

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

For development (auto-restart on changes), you can use:

```bash
npx nodemon server.js
```

---

## How to Play

1. Open the app and **create a room** — share the room code with your friends
2. Friends **join the room** from their own devices using the code
3. One player **spins the bottle** — it lands on someone
4. That player picks **Truth or Dare**
5. A prompt is revealed — answer honestly or take the dare
6. Repeat until the night gets interesting

---

## Project Structure

```
Spin-n-Spill/
├── public/          # Static frontend files (HTML, CSS, JS)
├── server.js        # Express + Socket.io server
├── package.json
└── .env             # Environment config (not committed)
```

---

## Contributing

Pull requests are welcome! If you have ideas for new prompts, features, or UI improvements, feel free to open an issue or submit a PR.

---

## License

This project is open source. See the repository for details.
