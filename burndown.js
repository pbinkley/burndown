$.urlParam = function(name, url) {
    if (!url) {
     url = window.location.href;
    }
    var results = new RegExp('[\\?&]' + name + '=([^&#]*)').exec(url);
    if (!results) { 
        return undefined;
    }
    return results[1] || undefined;
}

var config, repodata;
var issuedata = {
    "closed": {"issues": 0, "points": 0},
    "wip": {"issues": 0, "points": 0},
    "ready": {"issues": 0, "points": 0}
}
var pullmap = [];
var showBody = function () {
    return markdown.toHTML(this.body)
};
var showTime = function() {
    var m = moment(this.created_at);
    var f = "ddd, MMM Do, HH:mm";
    return m.format(f);
};
$.fn.sort = function(){
    return this.pushStack([].sort.apply(this, arguments), []);
};

function sortByClosedAt(a, b){
    var date1 = !a.closed_at ? '1970-01-01T00:00:00Z' : a.closed_at;
    var date2 = !b.closed_at ? '1970-01-01T00:00:00Z' : b.closed_at;

    return date1 > date2 ? 1 : -1;
}

function showIssue(ul, issue) {
    issue_template = $('#issue_template').html();
    people_template = $('#people_template').html();
    ul.append(Mustache.to_html(issue_template, issue, {people: people_template}));
}

function showMilestone(owner, repo, milestone, pulls) {

    var perPage = 30,
    totalPages = 0,
    totalIssues = 0,
    totalPoints = 0,
    closedPoints = 0,
    numberOfClosedIssues = 0,
    numberOfOpenIssues = 0,
    actual = [], jsonData = [], issueData = [],
    ideal;

    // fetch issues in milestone from GitHub API
    $.getJSON('https://api.github.com/repos/' + owner + '/' + repo + 
        '/issues?' + 
        '&state=all&sort=created&direction=asc&milestone=' + milestone, 
        function(data){

        // sort issues by closed timestamp, to build the graph
        issues = data.sort(sortByClosedAt);

        // count open and closed issues
        $.each(issues, function(i, issue){
            if(!issue.closed_at)
                numberOfOpenIssues++;
            else
                numberOfClosedIssues++;
        });
        totalIssues = numberOfClosedIssues + numberOfOpenIssues;

        numberOfClosedIssues = 0; //reset in order to increment through
        milestonedata = null;

        // parse issues
        $.each(issues, function(i, issue){
            if (milestonedata == null) {
                milestonedata = issue.milestone;
            }
            var points = config.defaultpoints;
            var labelnames = [];
            $.each (issue.labels, function(i, label){
                labelnames.push(label.name);
            });
            // lookup up size labels
            $.each (config.sizes, function(i, size) {
                if (labelnames.indexOf(size.label) > - 1) points = size.points;
                // this is how you break out of $.each
                return false;
            });
            issue.burndown_points = points;
            totalPoints += points;
            if(issue.closed_at){
                closedPoints += points;
                numberOfClosedIssues++;
                actual.push({date: new Date(issue.closed_at), points: closedPoints});
                issueData.push('#' + issue.number + ': ' + issue.title);
            }
        });

        // re-sort by priority
        var sortedIssues = [];
        // create array of arrays, using priority labels plus "none", into which to gather issues
        var priorities = config.priorities.slice();
        priorities.push("none");
        $.each(priorities, function(i, priority) {
            sortedIssues[priority] = [];
        });
        // populate arrays of issues according to priority label
        $.each(issues, function(i, issue){
            var status;
            if (issue.closed_at)
                status="closed"
            else if (issue.assignee)
                status="wip"
            else status="ready";
            issuedata[status].issues += 1;
            issuedata[status].points += issue.burndown_points;

            var labelFound = false;
            $.each(issue.labels, function(j, label){
                if ($.inArray(label.name, config.priorities) > -1) {
                    if (!sortedIssues[label.name][status])
                        sortedIssues[label.name][status] = [];
                    sortedIssues[label.name][status].push(issue);
                    labelFound = true;
                }
            });
            if (!labelFound) {
                if (!sortedIssues["none"][status])
                    sortedIssues["none"][status] = [];
                sortedIssues["none"][status].push(issue);
            }

            // add associated PR
            pull = $.grep( pullmap, function( n, i ) {
                return n.issue == issue.number;
            });
            if (pull[0]) {
                issue.burndown_pull = pull[0].pull;
            }

            // add markdown transformation function
            issue.burndown_showBody = showBody;
            issue.burndown_showTime = showTime;
        });

        // show issues in columns
        $.each(["closed", "wip", "ready"], function(j, status) {
            $.each(priorities, function(i, priority) {
                if (sortedIssues[priority][status]) {
                    ul = $("<ul class='" + priority + " list-group'>")
                        $.each(sortedIssues[priority][status], function(k, issue){
                            showIssue(ul, issue);
                        });
                    $("#" + status).append($("<h3>" + priority + "</h3>")).append(ul);
                }
            });
        });

        // add counts to column headers
        for (status in issuedata) {
            var data = issuedata[status];
            $("#" + status + "data").html("(" + data.issues + " issues, " 
                + data.points + " points)");
        }

        // update headings
        $("#h1").html("<a href='" + repodata.html_url + "'>" + repodata.full_name + "</a>: <a href='" + milestonedata.html_url + "'>" + milestonedata.title + "</a>");
        $("#description").html(repodata.description);
        document.title = milestonedata.title + " / " + repodata.full_name;

        // prepare data for d3
        end = new Date(milestonedata.due_on);
        end.setDate(end.getDate() + 1);
        start = new Date(milestonedata.due_on);
        start.setDate(start.getDate() - 11);

        // add starting point to actual line
        actual.splice(0, 0, {date: start, points: 0});

        // extend actual to now
        today = new Date(new Date().toISOString());
        lastpoints = actual[actual.length - 1].points;
        actual.push({date: today, points: lastpoints});

        // fill in values on ideal line, reflecting weekends when the line
        // does not go down.

        var cur = new Date(),
        isworkday = [],
        curPoints = totalPoints,
        workdays = 0,
        pointsPerDay = 0,
        ideal = [];

        // count workdays
        cur.setTime(start.getTime());
        while(cur <= end) {
            weekday = cur.getDay();
            datestring = cur.toISOString().substring(0, 10); // get yyyy-mm-dd
            // workdays: weekday is on workweek list and date is not on holidays list
            if ((config.workweek.indexOf(weekday) > -1) && (config.holidays.indexOf(datestring) == -1)) {
                workdays++;
                isworkday.push(true);
            }
            else
                isworkday.push(false);
            cur.setDate(cur.getDate() + 1);
        }

        pointsPerDay = totalPoints / workdays;

        // assign points to days for ideal line
        cur.setTime(start.getTime());
        i = 0;
        while(cur <= end) {
            ideal.push({date:new Date(cur.getTime()), points: curPoints});
            weekday = cur.getDay();
            datestring = cur.toISOString().substring(0, 10); // get yyyy-mm-dd
            if (isworkday[i])
                curPoints -= pointsPerDay;
            cur.setDate(cur.getDate() + 1);
            i += 1;
        }

        renderChart(ideal, actual, totalPoints);

    })

}

// global vars for chart
var width, margin, x, y, chart;

function renderChart(ideal, actual, totalPoints) {
    // lay out chart
    margin = {top: 30, right: 10, bottom: 30, left: 30};
    width = parseInt(d3.select('#chart').style('width'), 10);
    width = width - margin.left - margin.right;
    percent = d3.format('%');
    height = 500 - margin.top - margin.bottom;

    var customformat = d3.time.format.multi([
  [".%L", function(d) { return d.getMilliseconds(); }],
  [":%S", function(d) { return d.getSeconds(); }],
  ["%I:%M", function(d) { return d.getMinutes(); }],
  ["%I %p", function(d) { return d.getHours(); }],
  ["%a %e", function(d) { return d.getDay() && d.getDate() != 1; }],
  ["%b %d", function(d) { return d.getDate() != 1; }],
  ["%B", function(d) { return d.getMonth(); }],
  ["%Y", function() { return true; }]
]);
    
    var x = d3.time.scale()
        .range([0, width]);
    var y = d3.scale.linear()
        .range([height, 0]);


    var idealLine = d3.svg.line()
        .x(function(d) { return x(d.date); })
        .y(function(d) { return y(d.points); });
    var actualLine = d3.svg.line()
        .x(function(d) { return x(d.date); })
        .y(function(d) { return y(totalPoints - d.points); });

    x.domain(d3.extent(ideal, function(d){return d.date;}));
    y.domain([0, totalPoints]);

    xAxis = d3.svg.axis()
        .scale(x)
        .orient("bottom")
        .tickFormat(customformat)
        .tickSize(-height, 0, 0);
    yAxis = d3.svg.axis()
        .scale(y)
        .orient("left")
        .tickSize(-width, 0, 0);

    chart = d3.select("#chart").append("svg")
        .attr("class", "chart")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    // center the day labels under their column
    // based on http://stackoverflow.com/questions/17544546/d3-js-align-text-labels-between-ticks-on-the-axis/17544785#answer-17630938
    function adjustTextLabels(selection) {
        // remove last label (for the day after the end of the milestone)
        labels = selection.selectAll('.chart text');
        labels[0][labels[0].length - 1].remove();
        // transform remaining labels: move right 1/2 width of day column
        selection.selectAll('.chart text')
        .attr('transform', 'translate(' + daysToPixels(1) / 2 + ',0)');
    }

    // calculate the width of the days in the timeScale
    function daysToPixels(days, timeScale) {
        var d1 = new Date();
        return x(d3.time.day.offset(d1, days)) - x(d1);
    }

    chart.append("g")         
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxis)
        .call(adjustTextLabels);     // adjusts text labels on the axis 

    chart.append("g")
        .attr("class", "y axis")
        .call(yAxis)
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -40)
        .attr("dy", ".71em")
        .style("text-anchor", "end")
        .text("Points");

    // Paint the ideal line
    chart.append("path")
        .datum(ideal)
        .attr("class", "line ideal")
        .attr("d", idealLine);

    // Paint the actual line
    chart.append("path")
        .datum(actual)
        .attr("class", "line actual")
        .attr("d", actualLine);

}

function showRepo(owner, repo, milestone, pulls) {
    // only value of milestone is "current": redirect to first milestone in list
    var format = d3.time.format("%a, %e %b %Y");

    $.getJSON('https://api.github.com/repos/' + config.owner + '/' + config.repo + 
        '/milestones?state=open&sort=due_on&direction=desc', 
        function(data){
            if (milestone == "current") {
                var current = data[0].number;
                showMilestone(owner, repo, current, config);
            }
            else {
                heading_template = $('#heading_template').html();
                $("#heading").html(Mustache.to_html(heading_template, repodata));
                document.title = repodata.full_name;

                // note: sorted on due date, descending - milestones without due dates sort to end

                $.each(data, function(i, milestone){
                    // add formatted due date for display
                    if (milestone["due_on"])
                        milestone["burndown_due_on"] = format(new Date(milestone["due_on"]))
                });

                repodata = {
                    "owner": owner,
                    "repo": repo,
                    "milestones": data
                }
                repo_template = $('#repo_template').html();
                $("#chart").append(Mustache.to_html(repo_template, repodata));
            }
        }
    )
}

function getPullIssues(pulls) {
    ul = $("<ul class='list-group'>");
    initial_number_re = /^\d+/;
    // see https://help.github.com/articles/closing-issues-via-commit-messages/
    closes_number_re = /[Close|Closed|Closes|Fix|Fixed|Fixes|Resolve|Resolved|Resolves] \#\d+/i;
    number_re = /\d+/;
    $.each(pulls, function(k, pull){
        // look for issue number at beginning of branch name
        var issue = initial_number_re.exec(pull.head.ref); 
        // or in a "Closes" phrase in body
        if (issue == null) {
            issue = closes_number_re.exec(pull.body);
            if (issue != null) 
                issue = number_re.exec(issue);
        }
        // if we have an associated issue, store it
        if (issue != '') {
            pull.burndown_issue = issue;
            pullmap.push({"pull": pull.number, "issue": issue});           
        }
        // add markdown transformation function
        pull.burndown_showBody = showBody;
        pull.burndown_showTime = showTime;
        pull.burndown_isPull = true;
        showIssue(ul, pull);
    });
    $("#pulls").append(ul);


    return pulls;
}

$(document).ready(function(){

    $.getJSON( "config.json", function( cfg ) {

        config = cfg;

        var owner = $.urlParam("owner");
        owner = (owner === undefined) ? config.owner : owner;
        var repo = $.urlParam("repo");
        repo = (repo === undefined) ? config.repo : repo;
        var milestone = $.urlParam("milestone");

        $.getJSON('https://api.github.com/repos/' + owner + '/' + repo + '/pulls', 
            function(data){

                var pulls = getPullIssues(data);

                $.getJSON('https://api.github.com/repos/' + owner + '/' + repo, 
                    function(data){

                    repodata = data;

                    // we assume config has a default owner and repo - only question
                    // is whether we have a milestone

                    if (milestone == "current")
                        showRepo(owner, repo, milestone, pulls);
                    else if (milestone)
                        showMilestone(owner, repo, milestone, pulls);
                    else
                        showRepo(owner, repo, milestone, pulls);
                });
       });

    })

});
