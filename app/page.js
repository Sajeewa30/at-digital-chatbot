import Chatbot from '../components/Chatbot';

export default function Home() {
  const config = {
    typingSpeedMs: 15, // milliseconds per character (lower is faster)
    webhook: {
      route: 'general',
    },
    branding: {
      logo: '/logo.jpg',
      name: 'AT Digital',
      welcomeText: 'Hi there! Welcome to AT Digital.',
      responseTimeText: 'We typically respond right away',
    },
    style: {
      primaryColor: '#4C46F7',
      secondaryColor: '#7A5CFF',
      position: 'right',
      backgroundColor: '#0B1025',
      fontColor: '#E4E7FF',
    },
  };

  return (
    <main>
      <Chatbot config={config} />
    </main>
  );
}
