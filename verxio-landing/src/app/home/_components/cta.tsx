"use client";

import { appPath } from "@/lib/site";

export function CTA() {
  return (
    <section className="py-24 bg-gray-50">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 tracking-tight">
          Put the agent on your machine.
        </h2>
        <p className="mt-4 text-lg text-gray-600 max-w-xl mx-auto">
          Download Verxio. The workspace, computer use, files, terminal, and your channels come
          with it.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href={appPath("/download")}
            className="inline-flex items-center px-8 py-4 text-sm font-semibold text-white bg-primary rounded-lg hover:brightness-110 transition-all shadow-md shadow-primary/20"
          >
            Download Verxio
            <svg
              className="ml-2 w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
