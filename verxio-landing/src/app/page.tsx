import { Navbar } from "./home/_components/navbar";
import { Hero } from "./home/_components/hero";
import { Features } from "./home/_components/features";
import { IntegrationsOrbit } from "./home/_components/integrations-orbit";
import { HowItWorks } from "./home/_components/how-it-works";
import { CTA } from "./home/_components/cta";
import { Footer } from "./home/_components/footer";
import type { Metadata } from "next";

const siteUrl = "https://www.verxio.xyz";

export const metadata: Metadata = {
  title: "Verxio — AI work OS",
  description:
    "Verxio is an AI work OS for your machine. The agent uses your screen, files, terminal, Notepad, connected apps, and messaging channels.",
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: "Verxio — AI work OS",
    description:
      "A workspace on your machine where the agent does the work. Computer use, files, terminal, Notepad, and your apps.",
    url: siteUrl,
    siteName: "Verxio",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: `${siteUrl}/logo/verxioLogoMain.svg`,
        width: 1200,
        height: 630,
        alt: "Verxio — AI work OS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Verxio — AI work OS",
    description:
      "A workspace on your machine where the agent does the work.",
    images: [`${siteUrl}/logo/verxioLogoMain.svg`],
  },
};

export default function Home() {
  const siteUrl = "https://www.verxio.xyz";

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Verxio",
      url: siteUrl,
      description:
        "AI work OS. A desktop workspace where your agent uses the screen, files, terminal, Notepad, connected apps, and messaging channels.",
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteUrl}/search?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Verxio",
      url: siteUrl,
      logo: `${siteUrl}/logo/verxioLogoMain.svg`,
      sameAs: ["https://twitter.com/verxioprotocol", "https://blog.verxio.xyz"],
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Verxio",
      applicationCategory: "BusinessApplication",
      operatingSystem: "macOS, Windows, Linux",
      description:
        "Desktop AI work OS. The agent uses your screen, files, terminal, Notepad, connected apps, and messaging channels.",
      url: siteUrl,
      featureList:
        "Computer Use, Workspace, Local Files, Terminal, Notepad, On-device Whisper, Projects, App Connections, Telegram, WhatsApp, Slack, Discord",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Verxio Blog",
      url: "https://blog.verxio.xyz",
      description:
        "Articles and guides from the Verxio team.",
      isPartOf: {
        "@type": "WebSite",
        name: "Verxio",
        url: siteUrl,
      },
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <div className="min-h-screen bg-white">
        <Navbar />
        <Hero />
        <Features />
        <IntegrationsOrbit />
        <HowItWorks />
        <CTA />
        <Footer />
      </div>
    </>
  );
}
