(function () {
  "use strict";

  var catalogPromise;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char];
    });
  }

  function inline(text) {
    var safe = escapeHtml(text);
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, href) {
      var decoded = href.replace(/&amp;/g, "&");
      if (!/^(https?:\/\/|\.\.?\/|assets\/)/i.test(decoded)) return label + "（链接已阻止）";
      return '<a href="' + escapeHtml(decoded) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
    return safe;
  }

  function renderMarkdown(markdown) {
    var lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    var html = [];
    var paragraph = [];
    var listType = null;
    var inCode = false;
    var code = [];

    function flushParagraph() {
      if (paragraph.length) {
        html.push("<p>" + inline(paragraph.join(" ")) + "</p>");
        paragraph = [];
      }
    }
    function closeList() {
      if (listType) { html.push("</" + listType + ">"); listType = null; }
    }

    lines.forEach(function (line) {
      if (/^```/.test(line)) {
        flushParagraph(); closeList();
        if (inCode) {
          html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
          code = []; inCode = false;
        } else { inCode = true; }
        return;
      }
      if (inCode) { code.push(line); return; }
      var heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList();
        var level = heading[1].length;
        html.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
        return;
      }
      var unordered = line.match(/^\s*[-*]\s+(.+)$/);
      var ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        var desired = unordered ? "ul" : "ol";
        if (listType !== desired) { closeList(); listType = desired; html.push("<" + desired + ">"); }
        html.push("<li>" + inline((unordered || ordered)[1]) + "</li>");
        return;
      }
      var quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph(); closeList(); html.push("<blockquote>" + inline(quote[1]) + "</blockquote>"); return;
      }
      if (!line.trim()) { flushParagraph(); closeList(); return; }
      paragraph.push(line.trim());
    });
    if (inCode) html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
    flushParagraph(); closeList();
    return html.join("\n");
  }

  async function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch("content/course-catalog.json", { cache: "no-cache" }).then(function (response) {
        if (!response.ok) throw new Error("课程目录加载失败");
        return response.json();
      });
    }
    return catalogPromise;
  }

  function assignments(catalog) {
    var result = [];
    catalog.courses.forEach(function (course) {
      course.chapters.forEach(function (chapter) {
        if (chapter.assignment) result.push(Object.assign({ courseId: course.id, courseTitle: course.shortTitle, chapterId: chapter.id }, chapter.assignment));
      });
    });
    return result;
  }

  window.CourseContent = { escapeHtml: escapeHtml, renderMarkdown: renderMarkdown, loadCatalog: loadCatalog, assignments: assignments };
})();
